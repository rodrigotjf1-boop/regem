import { BadRequestException, Inject, Injectable, Logger, NotFoundException, OnModuleInit, Optional } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { cortarSessoes } from '../../auth/sessao-corte';
import { ehServidorLocal } from '../../common/modo';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { PREFIXO_NAO_RECONHECO, lerNaoReconheco } from './mister-avisos.regras';
import { DIAS_SEM_CONVERSA, MOTIVO_NA_TELA, desligarVinculo, ehMotivoDoDesligamento } from './mister-desligar';
import { MisterEntradaService, QuemTocou } from './mister-entrada.service';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A SEGURANÇA DO VÍNCULO (versão 6, M6a; plano aprovado em 20/11/2026; `mockups/regem-mister-v6.html`, "Segurança" e
// "Console da DMS"; mig 468):
//  • o vencimento: o WhatsApp de quem não conversa com o Mister há 60 dias sai sozinho (decisão V6-3), numa volta diária;
//  • o "Não reconheço": o presidente toca no aviso de telefone ligado e o telefone sai na hora;
//  • o console da DMS: a Diretoria vê quem está ligado numa empresa (só o final do número) e desliga, com o motivo na
//    auditoria do console — para quem não consegue entrar no Regem (não existe "esqueci a senha").
// Tudo pelo mesmo caminho do desligamento (`mister-desligar.ts`), com o motivo guardado.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** No máximo estes vencimentos por volta (a volta seguinte, no dia seguinte, pega o resto). */
export const VENCIDOS_POR_VOLTA = 500;
/** O motivo que a Diretoria escreve no console: obrigatório, para a auditoria dizer por quê. */
export const MOTIVO_DO_CONSOLE_MIN = 10;
export const MOTIVO_DO_CONSOLE_MAX = 300;

export const TEXTOS_DA_SEGURANCA = {
  naoReconheco: (nome: string, final: string) =>
    `Pronto: desliguei o WhatsApp final ${final} de ${nome} do Mister. Se for mesmo dele, ele liga de novo dentro do Regem, no menu Mister, em "Pessoas".`,
  jaSaiu: 'Esse telefone já não está ligado ao Mister (foi desligado ou ligado de novo depois do aviso).',
  soPresidente: 'Só o presidente da empresa pode desligar um telefone do Mister.',
} as const;

export interface PessoaNoConsole {
  colaboradorId: string;
  nome: string;
  nivel: 'presidente' | 'gerente';
  /** Os quatro últimos dígitos — o console nunca vê o número. */
  final: string | null;
  situacao: 'ligado' | 'pausado' | 'desligado' | 'nunca';
  ligadoEm: string | null;
  desligado: { em: string; motivo: string } | null;
}

@Injectable()
export class MisterVinculoSegurancaService implements OnModuleInit {
  private readonly logger = new Logger('MisterVinculoSeguranca');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    @Optional() private readonly entrada?: MisterEntradaService,
    @Optional() private readonly numero?: MisterNumeroService,
    @Optional() private readonly auditoria?: AuditoriaService,
    @Optional() private readonly eventos?: EventEmitter2,
  ) {}

  onModuleInit(): void {
    this.entrada?.registrarBotao(PREFIXO_NAO_RECONHECO, (botaoId, quem) => this.naoReconheco(botaoId, quem));
  }

  // ───────────────────────────── o vencimento (60 dias sem conversa) ─────────────────────────────

  /** Uma volta por dia, de madrugada (só na nuvem). A condição é do banco: perder uma volta só atrasa um dia. */
  @Cron('20 4 * * *')
  async rotina(): Promise<void> {
    if (ehServidorLocal() || this.rodando) return;
    this.rodando = true;
    try {
      const n = await this.vencer();
      if (n) this.logger.log(`vínculos do Mister vencidos por ${DIAS_SEM_CONVERSA} dias sem conversa: ${n}`);
    } catch (e: any) {
      this.logger.error(`o vencimento dos vínculos do Mister falhou — ${e?.message ?? e}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  /**
   * Desliga quem não conversa há 60 dias: nem pergunta, nem toque em botão (os dois gravam `ultima_entrada_em`). A conta
   * começa no `ligado_em` de quem ligou e nunca escreveu. Devolve quantos saíram. `soEmpresas`: só estas (os testes).
   */
  async vencer(soEmpresas?: string[]): Promise<number> {
    const so = soEmpresas?.length ? sql`and g.tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    const vencidos = linhas(
      await this.db.execute(sql`
        select g.tenant_id::text as "tenantId", g.colaborador_id::text as "colaboradorId"
          from mister_vinculo g
         where g.ligado_em is not null and g.telefone is not null
           and greatest(g.ligado_em, coalesce(g.ultima_entrada_em, g.ligado_em)) < clock_timestamp() - make_interval(days => ${DIAS_SEM_CONVERSA}::int)
           ${so}
         limit ${VENCIDOS_POR_VOLTA}`),
    );
    let saiu = 0;
    for (const v of vencidos) {
      const d = await desligarVinculo(this.db, { tenantId: v.tenantId, colaboradorId: v.colaboradorId, motivo: 'vencido' });
      if (!d) continue;
      saiu++;
      await this.auditoria?.registrar({
        tenantId: v.tenantId,
        atorId: null,
        atorPerfil: 'sistema',
        tipo: 'config',
        acao: 'mister_whatsapp_vencido',
        entidadeTipo: 'mister_vinculo',
        entidadeId: v.colaboradorId,
        origem: 'sistema',
        detalhe: { dias: DIAS_SEM_CONVERSA, final: d.telefone ? d.telefone.slice(-4) : null },
      });
    }
    return saiu;
  }

  // ───────────────────────────── "Não reconheço" ─────────────────────────────

  /**
   * O toque no "Não reconheço" do aviso de telefone ligado. Só o presidente da empresa daquele telefone, e só enquanto o
   * telefone for o DAQUELA ligação (quem religou depois do aviso não cai por um toque antigo). `false` = não é deste botão.
   */
  async naoReconheco(botaoId: string, quem: QuemTocou): Promise<boolean> {
    const b = lerNaoReconheco(botaoId);
    if (!b || !quem.vinculos.length) return false;
    // Só nas empresas deste telefone: o toque nunca alcança a pessoa de outra empresa.
    const [alvo] = linhas(
      await this.db.execute(sql`
        select g.tenant_id::text as "tenantId", c.nome
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
         where g.colaborador_id = ${b.colaboradorId}::uuid
           and g.tenant_id in (${sql.join(quem.vinculos.map((v) => sql`${v.tenantId}::uuid`), sql`, `)})`),
    );
    if (!alvo) return false;
    const presidente = quem.vinculos.find((v) => v.tenantId === alvo.tenantId && v.nivel === 'presidente');
    if (!presidente) {
      await this.dizer(quem.telefone, TEXTOS_DA_SEGURANCA.soPresidente);
      return true;
    }
    const d = await desligarVinculo(this.db, { tenantId: alvo.tenantId, colaboradorId: b.colaboradorId, motivo: 'nao_reconheco', soSeLigadoEm: b.ligadoEm });
    if (!d?.telefone) {
      await this.dizer(quem.telefone, TEXTOS_DA_SEGURANCA.jaSaiu);
      return true;
    }
    await this.auditoria?.registrar({
      tenantId: alvo.tenantId,
      atorId: presidente.colaboradorId,
      atorPerfil: 'presidente',
      tipo: 'config',
      acao: 'mister_whatsapp_desligado',
      entidadeTipo: 'mister_vinculo',
      entidadeId: b.colaboradorId,
      origem: 'whatsapp',
      detalhe: { por: 'presidente', motivo: 'nao_reconheco', final: d.telefone.slice(-4) },
    });
    await this.dizer(quem.telefone, TEXTOS_DA_SEGURANCA.naoReconheco(String(alvo.nome ?? '').trim().split(/\s+/)[0] || 'a pessoa', d.telefone.slice(-4)));
    return true;
  }

  // ───────────────────────────── o console da DMS ─────────────────────────────

  /** Quem fala com o Mister numa empresa, para a Diretoria: o final do número e a situação. Nunca o número inteiro. */
  async pessoasDaEmpresa(tenantId: unknown): Promise<{ empresa: string; pessoas: PessoaNoConsole[] }> {
    const t = String(tenantId ?? '').trim();
    if (!UUID.test(t)) throw new BadRequestException('Empresa inválida.');
    const [emp] = linhas(await this.db.execute(sql`select nome from empresa where id = ${t}::uuid and deleted_at is null`));
    if (!emp) throw new NotFoundException('Empresa não encontrada.');
    const lidas = linhas(
      await this.db.execute(sql`
        select c.id::text as "colaboradorId", c.nome, coalesce(p.nivel, f.categoria::text) as nivel,
               g.telefone, g.pausado_em is not null as pausado,
               to_char(g.ligado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "ligadoEm",
               to_char(g.desligado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "desligadoEm", g.desligado_motivo as "desligadoMotivo"
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id and c.deleted_at is null
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
         where g.tenant_id = ${t}::uuid
         order by (g.telefone is not null) desc, (coalesce(p.nivel, f.categoria::text) = 'presidente') desc, c.nome
         limit 200`),
    );
    return {
      empresa: String(emp.nome),
      pessoas: lidas.map((l) => {
        const ligado = !!(l.telefone && l.ligadoEm);
        return {
          colaboradorId: l.colaboradorId,
          nome: String(l.nome),
          nivel: l.nivel === 'presidente' ? 'presidente' : 'gerente',
          final: ligado ? String(l.telefone).slice(-4) : null,
          situacao: ligado ? (l.pausado ? 'pausado' : 'ligado') : l.desligadoEm ? 'desligado' : 'nunca',
          ligadoEm: ligado ? l.ligadoEm : null,
          desligado: !ligado && l.desligadoEm && ehMotivoDoDesligamento(l.desligadoMotivo) ? { em: l.desligadoEm, motivo: MOTIVO_NA_TELA[l.desligadoMotivo] } : null,
        } satisfies PessoaNoConsole;
      }),
    };
  }

  /**
   * A Diretoria desliga o WhatsApp de uma pessoa (motivo `dms`). O motivo escrito vai para a auditoria do CONSOLE (quem
   * chama grava) e, na empresa, fica só "desligado pelo suporte da DMS". Devolve o final do número desligado.
   */
  async desligarPelaDms(
    tenantId: unknown,
    colaboradorId: unknown,
    motivo: unknown,
    encerrarSessoes: unknown = false,
  ): Promise<{ desligado: boolean; final: string | null; sessoesEncerradas: boolean }> {
    const t = String(tenantId ?? '').trim().toLowerCase();
    const c = String(colaboradorId ?? '').trim().toLowerCase();
    if (!UUID.test(t) || !UUID.test(c)) throw new BadRequestException('Empresa ou pessoa inválida.');
    const m = String(motivo ?? '').replace(/\s+/g, ' ').trim();
    if (m.length < MOTIVO_DO_CONSOLE_MIN) throw new BadRequestException(`Escreva o motivo (pelo menos ${MOTIVO_DO_CONSOLE_MIN} letras): ele vai para a auditoria.`);
    if (m.length > MOTIVO_DO_CONSOLE_MAX) throw new BadRequestException(`O motivo passa de ${MOTIVO_DO_CONSOLE_MAX} letras.`);
    // Versão 6, M6c (mig 473): "Encerrar também as sessões do Regem" — o "Perdi o celular" de quem não consegue entrar no
    // Regem. Só com `true` de verdade (V15). A pessoa tem de ser desta empresa; o corte vem antes do desligamento.
    let sessoesEncerradas = false;
    if (encerrarSessoes === true) {
      const [p] = linhas(await this.db.execute(sql`select 1 from colaborador where id = ${c}::uuid and tenant_id = ${t}::uuid and deleted_at is null`));
      if (!p) throw new NotFoundException('Pessoa não encontrada nesta empresa.');
      await cortarSessoes(this.db, { tenantId: t, colaboradorId: c, motivo: 'perdi_celular', por: 'dms' });
      this.eventos?.emit('sessao.cortada', { colaboradorId: c });
      sessoesEncerradas = true;
      await this.auditoria?.registrar({
        tenantId: t,
        atorId: null,
        atorPerfil: 'distribuicao',
        tipo: 'auth',
        acao: 'sessoes_encerradas',
        entidadeTipo: 'colaborador',
        entidadeId: c,
        origem: 'distribuicao',
        detalhe: { motivo: 'perdi_celular', por: 'suporte da DMS' },
      });
    }
    const d = await desligarVinculo(this.db, { tenantId: t, colaboradorId: c, motivo: 'dms' });
    if (d) {
      await this.auditoria?.registrar({
        tenantId: t,
        atorId: null,
        atorPerfil: 'distribuicao',
        tipo: 'config',
        acao: 'mister_whatsapp_desligado',
        entidadeTipo: 'mister_vinculo',
        entidadeId: c,
        origem: 'distribuicao',
        detalhe: { por: 'suporte da DMS', final: d.telefone ? d.telefone.slice(-4) : null },
      });
    }
    return { desligado: !!d, final: d?.telefone ? d.telefone.slice(-4) : null, sessoesEncerradas };
  }

  private async dizer(telefone: string, texto: string): Promise<void> {
    try {
      await this.numero?.enviar(telefone, { texto });
    } catch (e: any) {
      this.logger.warn(`a resposta do "Não reconheço" não saiu — ${e instanceof FalhaDoEnvioDoMister ? e.motivo : (e?.message ?? e)}`);
    }
  }
}
