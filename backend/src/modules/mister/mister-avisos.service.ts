import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { uuidDeChave } from '../../common/id-deterministico';
import { ehServidorLocal } from '../../common/modo';
import { AlertaKdsService } from '../kds/alerta-kds.service';
import { ModuloService } from '../modulo/modulo.service';
import { MisterAvisosConfigService } from './mister-avisos-config.service';
import {
  Destino,
  RegraDoAviso,
  Situacao,
  TipoDeAviso,
  dentroDaJanelaDoWhatsapp,
  deveEscalar,
  situacaoDaChave,
  situacaoDoCaixa,
  situacaoDoVigia,
  textoDoAviso,
  textoDoDesfecho,
} from './mister-avisos.regras';
import { FalhaDoEnvioDoMister, MisterNumeroService } from './mister-numero.service';
import { pessoaVale } from './mister-vinculo.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ROTINA DOS AVISOS DO MISTER (mig 419; F1.2 do `docs/plano-mister.md`; versão 2 do protótipo, aprovada em 14/11/2026).
//
// A cada minuto, só na NUVEM e só com `MISTER_AVISOS_LIGADOS=1` (nasce DESLIGADA — quem liga é o dono, no EasyPanel):
//  1. vê as situações de agora, de todas as empresas numa consulta por fonte: os incidentes abertos do vigia (impressora,
//     servidor sem sinal com pedido esperando, os técnicos), os caixas abertos há mais de 24 horas e a chave de IA parada;
//  2. aplica a regra de cada empresa (o que ela escolheu em Avisos e relatórios, ou o padrão aprovado) e o módulo Mister;
//  3. ABRE o episódio novo e entrega aos destinos; o que continua aberto e passou do tempo do "se ninguém resolver" ESCALA
//     (uma vez); o que sumiu FECHA e quem recebeu pelo WhatsApp recebe o desfecho.
//
// Entregas desta versão: WhatsApp do presidente e do gerente (pelo número do Mister, dentro da janela de 24 horas da Meta —
// fora dela o aviso pede o modelo aprovado, que é a próxima entrega, e fica anotado), KDS (o aviso do KDS, que desce da
// nuvem ao servidor da loja como o do Farol) e caso urgente no Atendimento (fecha sozinho quando o aviso resolve). "Tela
// do Regem na loja" e "Suporte da DMS" ficam anotados como "chega na próxima entrega".
//
// Concorrência: quem abre é o índice único parcial (a réplica a mais cai no `on conflict` e não entrega); quem escala e
// quem fecha é a gravação condicional (`where escalado_em is null` / `where situacao = 'aberto'`) — só quem gravou entrega.
// Nada daqui lança para a rotina: cada falha vira log e a volta segue.

const linhas = (r: any) => (r?.rows ?? r ?? []) as any[];
const semTabela = (e: any) => e?.code === '42P01' || e?.code === '42703';
const MODULO = 'mister';
/** Pedido "esperando" para o aviso do servidor sem sinal: aceito ou por aceitar, das últimas 3 horas. */
const PEDIDO_ESPERANDO_H = 3;

export const avisosLigados = (): boolean => ['1', 'true'].includes(String(process.env.MISTER_AVISOS_LIGADOS ?? '').trim().toLowerCase());

export type Fase = 'abriu' | 'escalou' | 'resolveu';
export interface Entrega {
  destino: Destino;
  fase: Fase;
  em: string;
  ok: boolean;
  motivo?: string;
  /** Os 4 últimos dígitos de quem recebeu pelo WhatsApp (nunca o telefone inteiro). */
  final?: string;
  /** O caso aberto no Atendimento (para fechar junto). */
  casoId?: string;
}

interface AvisoAberto {
  id: string;
  tenantId: string;
  unidadeId: string | null;
  tipo: TipoDeAviso;
  chave: string;
  titulo: string;
  detalhe: string | null;
  abertoEm: Date;
  escaladoEm: Date | null;
  entregas: Entrega[];
}

export interface ResultadoDaVoltaDosAvisos {
  situacoes: number;
  abertos: number;
  escalados: number;
  resolvidos: number;
  calados: number;
  entregas: number;
}

@Injectable()
export class MisterAvisosService {
  private readonly logger = new Logger('MisterAvisos');
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly config: MisterAvisosConfigService,
    private readonly numero: MisterNumeroService,
    private readonly modulos: ModuloService,
    @Optional() private readonly kds?: AlertaKdsService,
    @Optional() private readonly events?: EventEmitter2,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async rotina(): Promise<void> {
    if (ehServidorLocal() || !avisosLigados() || this.rodando) return;
    this.rodando = true;
    try {
      await this.volta();
    } catch (e: any) {
      if (!semTabela(e)) this.logger.error(`a volta dos avisos falhou — ${e?.message ?? e}`, e?.stack);
    } finally {
      this.rodando = false;
    }
  }

  // ───────────────────────────── as situações de agora ─────────────────────────────

  /** As situações de agora, de todas as empresas (ou só das pedidas, nos testes). Uma consulta por fonte. */
  async situacoes(soEmpresas?: string[]): Promise<Situacao[]> {
    const so = (col: string) =>
      soEmpresas?.length ? sql`and ${sql.raw(col)} in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    const fora: Situacao[] = [];

    // 1) O vigia. O servidor sem sinal só vira aviso com pedido esperando — e, depois de aberto, segue até o servidor voltar
    //    (senão o aviso "resolveria" quando os pedidos acabam, com o servidor ainda fora).
    const doVigia = await this.incidentesDoVigia(soEmpresas);
    for (const i of doVigia) {
      if (i.regra === 'servidor_sem_sinal' && !(Number(i.esperando) > 0) && !i.jaAberto) continue;
      const s = situacaoDoVigia({ ...i, evidencia: { ...(i.evidencia ?? {}), pedidosEsperando: i.esperando ?? null } }, String(i.loja ?? ''));
      if (s) fora.push(s);
    }

    // 2) O caixa aberto há mais de 24 horas.
    const caixas = linhas(
      await this.db.execute(sql`
        select s.id::text as id, s.tenant_id::text as "tenantId", s.unidade_id::text as "unidadeId", s.origem,
               floor(extract(epoch from (now() - s.aberta_em)) / 3600)::int as horas, col.nome as "abertoPor",
               coalesce(u.nome, emp.nome) as loja
          from caixa_sessao s
          join empresa emp on emp.id = s.tenant_id and emp.deleted_at is null
          left join unidade u on u.id = s.unidade_id and u.tenant_id = s.tenant_id
          left join colaborador col on col.id = s.aberta_por_id and col.tenant_id = s.tenant_id
         where s.status = 'aberta' and s.aberta_em < now() - interval '24 hours' ${so('s.tenant_id')}`),
    );
    for (const c of caixas) fora.push(situacaoDoCaixa({ ...c, horas: Number(c.horas) || 24, abertoPor: c.abertoPor ?? null }, String(c.loja ?? '')));

    // 3) A chave de IA da empresa parada (banco sem a 415: nada).
    try {
      const chaves = linhas(
        await this.db.execute(sql`
          select ic.tenant_id::text as "tenantId", ic.situacao from ia_credencial ic
            join empresa emp on emp.id = ic.tenant_id and emp.deleted_at is null
           where ic.situacao in ('sem_credito', 'teto_atingido', 'chave_recusada') ${so('ic.tenant_id')}`),
      );
      for (const k of chaves) {
        const s = situacaoDaChave(k);
        if (s) fora.push(s);
      }
    } catch (e: any) {
      if (!semTabela(e)) throw e;
    }
    return fora;
  }

  /**
   * Os incidentes ABERTOS do vigia (mig 414), com o nome da loja, os pedidos esperando (para o servidor sem sinal) e se o
   * aviso já está aberto. Banco sem a tabela do vigia = nenhum incidente.
   */
  protected async incidentesDoVigia(soEmpresas?: string[]): Promise<any[]> {
    const so = (col: string) =>
      soEmpresas?.length ? sql`and ${sql.raw(col)} in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``;
    try {
      return linhas(
        await this.db.execute(sql`
      select i.tenant_id::text as "tenantId", i.unidade_id::text as "unidadeId", i.regra, i.chave, i.evidencia,
             coalesce(u.nome, emp.nome) as loja,
             case when i.regra = 'servidor_sem_sinal' then (
               select count(*)::int from pedido_externo pe
                where pe.tenant_id = i.tenant_id and pe.status in ('novo', 'confirmado')
                  and (i.unidade_id is null or pe.unidade_id = i.unidade_id or pe.unidade_id is null)
                  and pe.criado_em > now() - make_interval(hours => ${PEDIDO_ESPERANDO_H})) end as esperando,
             exists (select 1 from mister_aviso a where a.tenant_id = i.tenant_id and a.situacao = 'aberto'
                      and a.chave = 'vigia:' || i.regra || ':' || i.chave) as "jaAberto"
        from vigia_incidente i
        join empresa emp on emp.id = i.tenant_id and emp.deleted_at is null
        left join unidade u on u.id = i.unidade_id and u.tenant_id = i.tenant_id
       where i.situacao = 'aberto' ${so('i.tenant_id')}`),
      );
    } catch (e: any) {
      if (semTabela(e)) return [];
      throw e;
    }
  }

  // ───────────────────────────── a volta ─────────────────────────────

  /** Uma volta: abre, escala e fecha. Devolve o que fez (os testes conferem). */
  async volta(soEmpresas?: string[], agora: Date = new Date()): Promise<ResultadoDaVoltaDosAvisos> {
    const res: ResultadoDaVoltaDosAvisos = { situacoes: 0, abertos: 0, escalados: 0, resolvidos: 0, calados: 0, entregas: 0 };
    const todas = await this.situacoes(soEmpresas);
    res.situacoes = todas.length;

    // O módulo Mister ligado (na loja do aviso) e o tipo ligado na regra da empresa.
    const regras = await this.config.regrasDe([...new Set(todas.map((s) => s.tenantId))]);
    const moduloLigado = new Map<string, boolean>();
    const vale = async (s: Situacao): Promise<RegraDoAviso | null> => {
      const k = `${s.tenantId}|${s.unidadeId ?? ''}`;
      if (!moduloLigado.has(k)) moduloLigado.set(k, await this.modulos.ativo(s.tenantId, s.unidadeId, MODULO).catch(() => false));
      const r = regras.get(s.tenantId)?.get(s.tipo);
      return moduloLigado.get(k) && r?.ligado ? r : null;
    };
    const valendo: { s: Situacao; r: RegraDoAviso }[] = [];
    const vistas = new Set<string>();
    for (const s of todas) {
      vistas.add(`${s.tenantId}|${s.tipo}|${s.chave}`);
      const r = await vale(s);
      if (r) valendo.push({ s, r });
    }
    const chaveDe = (a: { tenantId: string; tipo: string; chave: string }) => `${a.tenantId}|${a.tipo}|${a.chave}`;
    const valendoPorChave = new Map(valendo.map((v) => [chaveDe({ tenantId: v.s.tenantId, tipo: v.s.tipo, chave: v.s.chave }), v]));

    // 1) Abre o novo e renova o que continua (um comando para todos). Só quem ABRIU entrega.
    if (valendo.length) {
      const gravados = linhas(
        await this.db.execute(sql`
          insert into mister_aviso (tenant_id, unidade_id, tipo, chave, titulo, detalhe, dados)
          select x."tenantId", x."unidadeId", x.tipo, x.chave, x.titulo, x.detalhe, coalesce(x.dados, '{}'::jsonb)
            from jsonb_to_recordset(${JSON.stringify(valendo.map((v) => v.s))}::jsonb)
                 as x("tenantId" uuid, "unidadeId" uuid, tipo text, chave text, titulo text, detalhe text, dados jsonb)
          on conflict (tenant_id, tipo, chave) where situacao = 'aberto'
          do update set visto_em = clock_timestamp(), titulo = excluded.titulo, detalhe = excluded.detalhe, dados = excluded.dados
          returning id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", tipo, chave, titulo, detalhe,
                    aberto_em as "abertoEm", escalado_em as "escaladoEm", entregas, (xmax = 0) as novo`),
      ) as (AvisoAberto & { novo: boolean })[];
      for (const a of gravados) {
        const v = valendoPorChave.get(chaveDe(a));
        if (!v) continue;
        try {
          if (a.novo) {
            res.abertos++;
            res.entregas += await this.entregar(a, v.r.destinos, 'abriu', agora);
          } else if (deveEscalar({ abertoEm: new Date(a.abertoEm), escaladoEm: a.escaladoEm ? new Date(a.escaladoEm) : null }, v.r, agora.getTime())) {
            if (await this.marcarEscala(a.id)) {
              res.escalados++;
              res.entregas += await this.entregar(a, v.r.escalaPara, 'escalou', agora);
            }
          }
        } catch (e: any) {
          this.logger.error(`aviso ${a.id} (${a.tipo}): a entrega falhou — ${e?.message ?? e}`);
        }
      }
    }

    // 2) Fecha o que acabou. A situação sumiu = resolvido (com o desfecho a quem recebeu pelo WhatsApp); a situação continua
    //    mas o tipo ou o módulo foi desligado = fecha calado.
    const abertos = linhas(
      await this.db.execute(sql`
        select id::text as id, tenant_id::text as "tenantId", unidade_id::text as "unidadeId", tipo, chave, titulo, detalhe,
               aberto_em as "abertoEm", escalado_em as "escaladoEm", entregas
          from mister_aviso
         where situacao = 'aberto' ${soEmpresas?.length ? sql`and tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})` : sql``}`),
    ) as AvisoAberto[];
    for (const a of abertos) {
      if (valendoPorChave.has(chaveDe(a))) continue;
      const calado = vistas.has(chaveDe(a));
      try {
        const fechou = linhas(
          await this.db.execute(sql`
            update mister_aviso set situacao = 'resolvido', resolvido_em = clock_timestamp(),
                   dados = dados || jsonb_build_object('fechou', ${calado ? 'desligado' : 'resolvido'}::text)
             where id = ${a.id}::uuid and situacao = 'aberto' returning id`),
        );
        if (!fechou.length) continue;
        if (calado) res.calados++;
        else {
          res.resolvidos++;
          res.entregas += await this.desfecho(a, agora);
        }
        await this.fecharCasos(a);
      } catch (e: any) {
        this.logger.error(`aviso ${a.id} (${a.tipo}): o fechamento falhou — ${e?.message ?? e}`);
      }
    }
    return res;
  }

  /** Marca a escala do aviso. Só UMA chamada ganha (a outra réplica não acha a linha sem `escalado_em`): só ela entrega. */
  async marcarEscala(id: string): Promise<boolean> {
    return linhas(await this.db.execute(sql`update mister_aviso set escalado_em = clock_timestamp() where id = ${id}::uuid and escalado_em is null and situacao = 'aberto' returning id`)).length > 0;
  }

  // ───────────────────────────── as entregas ─────────────────────────────

  /** Entrega o aviso aos destinos de uma fase e grava a trilha. Devolve quantas entregas saíram. */
  private async entregar(a: AvisoAberto, destinos: Destino[], fase: Fase, agora: Date): Promise<number> {
    const feitas: Entrega[] = [];
    const em = agora.toISOString();
    const texto =
      fase === 'escalou'
        ? `⏰ Sem solução há ${Math.max(1, Math.round((agora.getTime() - new Date(a.abertoEm).getTime()) / 60_000))} min. ${textoDoAviso(a)}`
        : textoDoAviso(a);

    // O WhatsApp: cada telefone recebe uma vez, mesmo que esteja em "presidente" e em "gerente".
    const pessoas = destinos.filter((d): d is 'presidente' | 'gerente' => d === 'presidente' || d === 'gerente');
    if (pessoas.length) feitas.push(...(await this.pelosWhatsapps(a, pessoas, texto, fase, em, agora)));

    for (const d of destinos) {
      if (d === 'kds') feitas.push(await this.noKds(a, fase, em));
      else if (d === 'atendimento' && fase === 'abriu') feitas.push(await this.noAtendimento(a, em));
      else if (d === 'tela' || d === 'dms') feitas.push({ destino: d, fase, em, ok: false, motivo: 'chega_na_proxima_entrega' });
    }
    if (feitas.length) await this.db.execute(sql`update mister_aviso set entregas = entregas || ${JSON.stringify(feitas)}::jsonb where id = ${a.id}::uuid`);
    return feitas.filter((f) => f.ok).length;
  }

  /** Quem recebe pelo WhatsApp: os ligados que ainda valem e não pararam os avisos. Sem gerente ligado na loja, vai ao presidente. */
  private async pelosWhatsapps(a: AvisoAberto, papeis: ('presidente' | 'gerente')[], texto: string, fase: Fase, em: string, agora: Date): Promise<Entrega[]> {
    const ligados = linhas(
      await this.db.execute(sql`
        select g.telefone, g.ultima_entrada_em as "ultimaEntrada", coalesce(p.nivel, f.categoria::text) as nivel, c.unidade_id::text as "unidadeId"
          from mister_vinculo g
          join colaborador c on c.id = g.colaborador_id and c.tenant_id = g.tenant_id
          left join funcao f on f.id = c.funcao_id
          left join perfil_acesso p on p.id = c.perfil_acesso_id
          join empresa emp on emp.id = g.tenant_id
         where g.tenant_id = ${a.tenantId}::uuid and g.ligado_em is not null and g.telefone is not null and g.pausado_em is null and ${pessoaVale()}`),
    );
    // O gerente da loja do aviso (sem loja no aviso: os gerentes da empresa; gerente sem loja vale para todas).
    const daLoja = (l: any) => !a.unidadeId || !l.unidadeId || l.unidadeId === a.unidadeId;
    const alvo = new Map<string, { destino: Destino; l: any; motivo?: string }>();
    for (const papel of papeis) {
      let quem = ligados.filter((l) => l.nivel === papel && (papel === 'presidente' || daLoja(l)));
      let motivo: string | undefined;
      if (papel === 'gerente' && !quem.length) {
        quem = ligados.filter((l) => l.nivel === 'presidente');
        motivo = 'sem_gerente_ligado_foi_ao_presidente';
      }
      if (!quem.length) alvo.set(`sem:${papel}`, { destino: papel, l: null, motivo: 'ninguem_ligado' });
      for (const l of quem) if (!alvo.has(l.telefone)) alvo.set(l.telefone, { destino: papel, l, motivo });
    }
    const fora: Entrega[] = [];
    for (const { destino, l, motivo } of alvo.values()) {
      if (!l) {
        fora.push({ destino, fase, em, ok: false, motivo });
        continue;
      }
      const final = String(l.telefone).slice(-4);
      if (!dentroDaJanelaDoWhatsapp(l.ultimaEntrada ? new Date(l.ultimaEntrada) : null, agora.getTime())) {
        fora.push({ destino, fase, em, ok: false, final, motivo: 'fora_da_janela_de_24h' });
        continue;
      }
      try {
        await this.numero.enviar(l.telefone, { texto });
        fora.push({ destino, fase, em, ok: true, final, ...(motivo ? { motivo } : {}) });
      } catch (e: any) {
        const m = e instanceof FalhaDoEnvioDoMister ? e.motivo : 'erro';
        fora.push({ destino, fase, em, ok: false, final, motivo: m });
      }
    }
    return fora;
  }

  /** O aviso no KDS da loja (o mesmo caminho do Farol: a linha desce ao servidor da loja). Uma vez por fase. */
  private async noKds(a: AvisoAberto, fase: Fase, em: string): Promise<Entrega> {
    if (!this.kds) return { destino: 'kds', fase, em, ok: false, motivo: 'sem_kds' };
    try {
      await this.kds.guardarEMostrar({
        tenantId: a.tenantId,
        unidadeId: a.unidadeId,
        id: uuidDeChave('mister-aviso', a.id, fase),
        titulo: a.titulo,
        detalhe: a.detalhe,
        prioridade: 'alta',
        tipo: 'gestao',
        fica: true,
        origem: 'Mister',
        ref: a.id,
        naLoja: true,
      });
      return { destino: 'kds', fase, em, ok: true };
    } catch (e: any) {
      return { destino: 'kds', fase, em, ok: false, motivo: String(e?.message ?? 'erro').slice(0, 120) };
    }
  }

  /** Um caso URGENTE no Atendimento (como o do estorno de Pix que falhou). Fecha sozinho quando o aviso resolve. */
  private async noAtendimento(a: AvisoAberto, em: string): Promise<Entrega> {
    try {
      const [caso] = linhas(
        await this.db.execute(sql`
          insert into atendimento_chamado (tenant_id, unidade_id, tipo, mensagem, prioridade)
          values (${a.tenantId}::uuid, ${a.unidadeId}::uuid, 'atendimento', ${`Aviso do Mister: ${a.titulo}.${a.detalhe ? ` ${a.detalhe}` : ''}`}, 'urgente')
          returning *`),
      );
      if (caso) this.events?.emit('atendimento.novo', { tenantId: a.tenantId, chamado: caso });
      return { destino: 'atendimento', fase: 'abriu', em, ok: !!caso, ...(caso ? { casoId: String(caso.id) } : {}) };
    } catch (e: any) {
      return { destino: 'atendimento', fase: 'abriu', em, ok: false, motivo: String(e?.message ?? 'erro').slice(0, 120) };
    }
  }

  /** O desfecho para quem recebeu pelo WhatsApp (de novo dentro da janela; fora dela, fica anotado). */
  private async desfecho(a: AvisoAberto, agora: Date): Promise<number> {
    // Quem recebeu pelo WhatsApp (o final do telefone → por qual destino recebeu).
    const receberam = new Map((a.entregas ?? []).filter((e) => e.ok && e.final && (e.destino === 'presidente' || e.destino === 'gerente')).map((e) => [e.final as string, e.destino]));
    if (!receberam.size) return 0;
    const minutos = Math.max(1, Math.round((agora.getTime() - new Date(a.abertoEm).getTime()) / 60_000));
    const texto = textoDoDesfecho(a, minutos);
    const ligados = linhas(
      await this.db.execute(sql`
        select telefone, ultima_entrada_em as "ultimaEntrada" from mister_vinculo
         where tenant_id = ${a.tenantId}::uuid and ligado_em is not null and telefone is not null and pausado_em is null`),
    );
    const feitas: Entrega[] = [];
    const em = agora.toISOString();
    for (const l of ligados) {
      const final = String(l.telefone).slice(-4);
      if (!receberam.has(final)) continue;
      if (!dentroDaJanelaDoWhatsapp(l.ultimaEntrada ? new Date(l.ultimaEntrada) : null, agora.getTime())) {
        feitas.push({ destino: receberam.get(final)!, fase: 'resolveu', em, ok: false, final, motivo: 'fora_da_janela_de_24h' });
        continue;
      }
      try {
        await this.numero.enviar(l.telefone, { texto });
        feitas.push({ destino: receberam.get(final)!, fase: 'resolveu', em, ok: true, final });
      } catch (e: any) {
        feitas.push({ destino: receberam.get(final)!, fase: 'resolveu', em, ok: false, final, motivo: e instanceof FalhaDoEnvioDoMister ? e.motivo : 'erro' });
      }
    }
    if (feitas.length) await this.db.execute(sql`update mister_aviso set entregas = entregas || ${JSON.stringify(feitas)}::jsonb where id = ${a.id}::uuid`);
    return feitas.filter((f) => f.ok).length;
  }

  /** Fecha o caso do Atendimento que o aviso abriu (se ainda estiver aberto). */
  private async fecharCasos(a: AvisoAberto): Promise<void> {
    const casos = (a.entregas ?? []).filter((e) => e.destino === 'atendimento' && e.casoId).map((e) => e.casoId as string);
    for (const id of casos) {
      const r = linhas(
        await this.db.execute(sql`
          update atendimento_chamado set status = 'resolvido', resolvido_em = now()
           where id = ${id}::uuid and tenant_id = ${a.tenantId}::uuid and status <> 'resolvido' returning id`),
      );
      if (r.length) this.events?.emit('atendimento.mudou', { tenantId: a.tenantId, id, motivo: 'aviso_do_mister_resolvido' });
    }
  }

  /** A limpeza diária: o aviso resolvido há mais de 90 dias sai. */
  @Cron('50 4 * * *')
  async limpar(): Promise<number> {
    if (ehServidorLocal()) return 0;
    try {
      return linhas(await this.db.execute(sql`delete from mister_aviso where situacao = 'resolvido' and resolvido_em < now() - interval '90 days' returning id`)).length;
    } catch (e: any) {
      if (!semTabela(e)) this.logger.warn(`a limpeza dos avisos falhou — ${e?.message ?? e}`);
      return 0;
    }
  }
}

