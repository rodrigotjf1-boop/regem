import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { AuthUser } from '../../auth/auth-user';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { MisterNumeroService } from './mister-numero.service';
import { CODIGO_VALE_MIN, NIVEIS_DO_MISTER, linkDoCodigo, mensagemDoCodigo, novoCodigo } from './mister.regras';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O VÍNCULO do telefone com a pessoa (mig 417) — o lado de DENTRO do Regem.
//  • Só a própria pessoa liga o próprio número: o código sai aqui, para quem está logado, e a ligação acontece quando a
//    mensagem com o código chega ao número do Mister (`mister-entrada.service.ts`). Ninguém digita telefone de ninguém.
//  • O código é único na nuvem inteira (índice sem a empresa): é ele que diz, na mensagem que chega, de qual empresa e
//    de qual pessoa é o telefone. Vale 10 minutos e uma vez.
//  • Quem pode: gerente ou presidente, ativo — conferido no banco a cada uso, não no que o token dizia ao entrar.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const TENTATIVAS_DE_CODIGO = 5;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Teto de linhas da parte "Pessoas" (gerentes e presidentes de uma empresa). */
export const PESSOAS_NA_LISTA = 200;

/** As condições de "esta pessoa ainda pode falar com o Mister", sobre `c` (colaborador), `f`, `p` e `emp`. */
export const pessoaVale = () => sql`
  c.deleted_at is null and c.status = 'ativo' and emp.deleted_at is null
  and coalesce(p.nivel, f.categoria::text) in (${sql.join(NIVEIS_DO_MISTER.map((n) => sql`${n}`), sql`, `)})`;

export interface MeuWhatsapp {
  /** O número do Mister está conectado e a distribuição liberou: dá para ligar e ser atendido. */
  disponivel: boolean;
  /** O número do Mister (só dígitos), para salvar nos contatos. */
  numeroDoMister: string | null;
  ligado: boolean;
  final: string | null;
  ligadoEm: string | null;
  pausado: boolean;
  /** O código que ainda vale, se a pessoa gerou um e ainda não usou. */
  codigo: { codigo: string; mensagem: string; link: string | null; expiraEm: string } | null;
}

export interface PessoaDoMister {
  colaboradorId: string;
  nome: string;
  nivel: 'presidente' | 'gerente';
  /** A loja do gerente (ele só fala dela); null = presidente (todas as lojas) ou gerente sem loja definida. */
  loja: string | null;
  /** É quem está logado. */
  voce: boolean;
  ligado: boolean;
  final: string | null;
  ligadoEm: string | null;
  pausado: boolean;
  pode: Array<'avisos' | 'consulta' | 'autorizacao'>;
}

export interface ListaDePessoas {
  disponivel: boolean;
  numeroDoMister: string | null;
  souPresidente: boolean;
  total: number;
  pessoas: PessoaDoMister[];
}

@Injectable()
export class MisterVinculoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly numero: MisterNumeroService,
    @Optional() private readonly auditoria?: AuditoriaService,
  ) {}

  private async podeFalar(user: AuthUser): Promise<boolean> {
    const r = linhas(
      await this.db.execute(sql`
        select 1
          from colaborador c
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = c.tenant_id
         where c.id = ${user.colaboradorId}::uuid and c.tenant_id = ${user.tenantId}::uuid and ${pessoaVale()}`),
    );
    return r.length > 0;
  }

  /** A situação do WhatsApp de quem está logado. */
  async meu(user: AuthUser): Promise<MeuWhatsapp> {
    const n = await this.numero.ler();
    const [v] = linhas(
      await this.db.execute(sql`
        select telefone, pausado_em is not null as pausado, codigo, (codigo_expira_em > now()) as "codigoVale",
               to_char(ligado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "ligadoEm",
               to_char(codigo_expira_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "expiraEm"
          from mister_vinculo
         where tenant_id = ${user.tenantId}::uuid and colaborador_id = ${user.colaboradorId}::uuid`),
    );
    const ligado = !!(v?.telefone && v?.ligadoEm);
    const numeroDoMister = n.situacao !== 'sem' ? n.numero : null;
    return {
      disponivel: n.situacao === 'conectado' && n.ligado,
      numeroDoMister,
      ligado,
      final: ligado ? String(v.telefone).slice(-4) : null,
      ligadoEm: ligado ? v.ligadoEm : null,
      pausado: ligado && v.pausado === true,
      codigo:
        v?.codigo && v.codigoVale === true
          ? { codigo: v.codigo, mensagem: mensagemDoCodigo(v.codigo), link: numeroDoMister ? linkDoCodigo(numeroDoMister, v.codigo) : null, expiraEm: v.expiraEm }
          : null,
    };
  }

  /**
   * Gera o código de ligar para quem está logado. O código anterior da pessoa deixa de valer. Quem já está ligado
   * continua ligado até a mensagem com o código novo chegar (é como se troca de celular).
   */
  async gerarCodigo(user: AuthUser): Promise<MeuWhatsapp> {
    if (!(await this.podeFalar(user))) throw new ForbiddenException('Só gerente ou presidente liga o WhatsApp ao Mister.');
    const n = await this.numero.ler();
    if (n.situacao !== 'conectado' || !n.numero || !n.ligado) throw new ConflictException('O Mister ainda não está disponível pelo WhatsApp. Fale com a Regem.');
    for (let i = 0; ; i++) {
      try {
        await this.db.execute(sql`
          insert into mister_vinculo (tenant_id, colaborador_id, codigo, codigo_expira_em)
          values (${user.tenantId}::uuid, ${user.colaboradorId}::uuid, ${novoCodigo()}, now() + make_interval(mins => ${CODIGO_VALE_MIN}))
          on conflict (tenant_id, colaborador_id) do update
            set codigo = excluded.codigo, codigo_expira_em = excluded.codigo_expira_em, atualizado_em = now()`);
        break;
      } catch (e: any) {
        // O mesmo código está aberto para outra pessoa (em qualquer empresa): sorteia outro.
        if (e?.code !== '23505' || i + 1 >= TENTATIVAS_DE_CODIGO) throw e;
      }
    }
    await this.auditar(user, 'mister_whatsapp_codigo', {});
    return this.meu(user);
  }

  /** Desliga o WhatsApp de quem está logado. */
  async desligar(user: AuthUser): Promise<MeuWhatsapp> {
    await this.desligarPessoa(user, user.colaboradorId);
    return this.meu(user);
  }

  /** O nível que a pessoa tem AGORA no banco (presidente ou gerente) — ou null se ela não pode falar com o Mister. */
  private async nivelDe(user: AuthUser): Promise<'presidente' | 'gerente' | null> {
    const [l] = linhas(
      await this.db.execute(sql`
        select coalesce(p.nivel, f.categoria::text) as nivel
          from colaborador c
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = c.tenant_id
         where c.id = ${user.colaboradorId}::uuid and c.tenant_id = ${user.tenantId}::uuid and ${pessoaVale()}`),
    );
    return l?.nivel === 'presidente' || l?.nivel === 'gerente' ? l.nivel : null;
  }

  /**
   * Quem fala com o Mister nesta empresa (a parte "Pessoas"): gerentes e presidentes ativos, com a situação do WhatsApp
   * de cada um. O PRESIDENTE vê todos; o GERENTE recebe só a própria linha — a lista dos outros nem sai do servidor.
   * De cada telefone sai só o final (quatro dígitos), nunca o número.
   */
  async pessoas(user: AuthUser): Promise<ListaDePessoas> {
    const nivel = await this.nivelDe(user);
    if (!nivel) throw new ForbiddenException('Só gerente ou presidente fala com o Mister.');
    const n = await this.numero.ler();
    const soEu = nivel === 'presidente' ? sql`` : sql`and c.id = ${user.colaboradorId}::uuid`;
    const lidas = linhas(
      await this.db.execute(sql`
        select c.id as "colaboradorId", c.nome, coalesce(p.nivel, f.categoria::text) as nivel, u.nome as loja,
               g.telefone, (g.pausado_em is not null) as pausado,
               to_char(g.ligado_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "ligadoEm",
               count(*) over ()::int as total
          from colaborador c
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = c.tenant_id
          left join unidade u on u.id = c.unidade_id and u.tenant_id = c.tenant_id
          left join mister_vinculo g on g.tenant_id = c.tenant_id and g.colaborador_id = c.id
         where c.tenant_id = ${user.tenantId}::uuid and ${pessoaVale()} ${soEu}
         order by (coalesce(p.nivel, f.categoria::text) = 'presidente') desc, (c.id = ${user.colaboradorId}::uuid) desc, c.nome, c.id
         limit ${PESSOAS_NA_LISTA}`),
    );
    return {
      disponivel: n.situacao === 'conectado' && n.ligado,
      numeroDoMister: n.situacao !== 'sem' ? n.numero : null,
      souPresidente: nivel === 'presidente',
      total: lidas.length ? Number(lidas[0].total) : 0,
      pessoas: lidas.map((l) => {
        const ligado = !!(l.telefone && l.ligadoEm);
        const presidente = l.nivel === 'presidente';
        return {
          colaboradorId: String(l.colaboradorId),
          nome: String(l.nome),
          nivel: presidente ? 'presidente' : 'gerente',
          loja: presidente ? null : l.loja ? String(l.loja) : null,
          voce: String(l.colaboradorId) === user.colaboradorId,
          ligado,
          final: ligado ? String(l.telefone).slice(-4) : null,
          ligadoEm: ligado ? l.ligadoEm : null,
          pausado: ligado && l.pausado === true,
          // O que cada um pode é pela hierarquia até existir o perfil de permissões (decisão do dono de 13/11/2026).
          pode: presidente ? ['avisos', 'consulta', 'autorizacao'] : ['avisos', 'consulta'],
        };
      }),
    };
  }

  /**
   * Desliga o WhatsApp de uma pessoa do Mister. Cada um desliga o próprio; o de outra pessoa, só o presidente — e só
   * dentro da empresa dele (a gravação filtra pela empresa de quem pede). Ligar de novo é sempre pela própria pessoa.
   */
  async desligarPessoa(user: AuthUser, colaboradorId: string): Promise<{ desligado: boolean }> {
    const alvo = String(colaboradorId ?? '').trim();
    if (!UUID.test(alvo)) throw new BadRequestException('Pessoa inválida.');
    const proprio = alvo === user.colaboradorId;
    if (!proprio && (await this.nivelDe(user)) !== 'presidente') throw new ForbiddenException('Só o presidente desliga o WhatsApp de outra pessoa.');
    const r = linhas(
      await this.db.execute(sql`
        update mister_vinculo
           set telefone = null, ligado_em = null, pausado_em = null, codigo = null, codigo_expira_em = null, atualizado_em = now()
         where tenant_id = ${user.tenantId}::uuid and colaborador_id = ${alvo}::uuid and (telefone is not null or codigo is not null)
        returning id`),
    );
    if (r.length) await this.auditar(user, 'mister_whatsapp_desligado', proprio ? { por: 'a própria pessoa' } : { por: 'presidente', colaboradorId: alvo }, alvo);
    return { desligado: r.length > 0 };
  }

  private async auditar(user: AuthUser, acao: string, detalhe: Record<string, unknown>, deQuem: string = user.colaboradorId): Promise<void> {
    await this.auditoria?.registrar({
      tenantId: user.tenantId,
      atorId: user.colaboradorId,
      atorPerfil: user.categoria,
      tipo: 'config',
      acao,
      entidadeTipo: 'mister_vinculo',
      entidadeId: deQuem,
      detalhe,
    });
  }
}
