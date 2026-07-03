import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pontoMarcacao, pontoAjuste, colaborador } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { EquipamentoService } from '../equipamento/equipamento.service';
import {
  comRetryUnico,
  minutosNaFaixaNoturna,
  fatorHoraExtra,
} from '../../common/regras-negocio';
import { MarcarPontoDto } from './dto/marcar-ponto.dto';
import { IncluirMarcacaoDto } from './dto/incluir-marcacao.dto';
import { CriarAjusteDto } from './dto/criar-ajuste.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
const RETENCAO_FOTO_DIAS = 90; // LGPD: retenção da foto do ponto até o expurgo.
const ENTRA = new Set(['entrada', 'intervalo_fim']);
const SAI = new Set(['saida', 'intervalo_inicio']);

function minutosTrabalhados(ms: { tipo: string; marcadoEm: any }[]): number {
  const ord = [...ms].sort(
    (a, b) => new Date(a.marcadoEm).getTime() - new Date(b.marcadoEm).getTime(),
  );
  let total = 0;
  let lastIn: number | null = null;
  for (const m of ord) {
    const t = new Date(m.marcadoEm).getTime();
    if (ENTRA.has(m.tipo)) {
      if (lastIn === null) lastIn = t;
    } else if (SAI.has(m.tipo)) {
      if (lastIn !== null) {
        total += t - lastIn;
        lastIn = null;
      }
    }
  }
  return Math.round(total / 60000);
}

// Minutos em horário noturno (22h–5h) das jornadas do dia: pareia entrada→saída
// como minutosTrabalhados e soma a faixa noturna de cada par.
function minutosNoturnos(ms: { tipo: string; marcadoEm: any }[]): number {
  const ord = [...ms].sort(
    (a, b) => new Date(a.marcadoEm).getTime() - new Date(b.marcadoEm).getTime(),
  );
  let total = 0;
  let lastIn: number | null = null;
  for (const m of ord) {
    const t = new Date(m.marcadoEm).getTime();
    if (ENTRA.has(m.tipo)) {
      if (lastIn === null) lastIn = t;
    } else if (SAI.has(m.tipo)) {
      if (lastIn !== null) {
        total += minutosNaFaixaNoturna(lastIn, t);
        lastIn = null;
      }
    }
  }
  return total;
}

function turnoMin(inicio: string, fim: string): number {
  const [h1, m1] = inicio.split(':').map(Number);
  const [h2, m2] = fim.split(':').map(Number);
  let d = h2 * 60 + m2 - (h1 * 60 + m1);
  if (d < 0) d += 24 * 60;
  return d;
}

@Injectable()
export class PontoService {
  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly auditoria: AuditoriaService,
    private readonly equipamentos: EquipamentoService,
    private readonly events: EventEmitter2,
  ) {}

  // Grava uma marcação com NSR sequencial POR EQUIPAMENTO (Portaria 671).
  // Sem equipamentoId (marcação web/gestor) resolve o REP-Software padrão da unidade.
  // Retry no choque de índice único (concorrência no NSR).
  private async gravarMarcacao(
    tenantId: string,
    dados: {
      colaboradorId: string;
      tipo: string;
      marcadoEm: Date;
      origem: string;
      registradoPorId: string;
      obs?: string;
      unidadeId?: string;
      equipamentoId?: string;
      fotoRef?: string;
      consentimentoLgpd?: boolean;
    },
  ) {
    const equipamentoId =
      dados.equipamentoId ??
      (await this.equipamentos.resolverPadrao(tenantId, dados.unidadeId)).id;
    // LGPD: só guarda a foto com consentimento explícito; define a data de expurgo (retenção).
    const comFoto = !!(dados.fotoRef && dados.consentimentoLgpd);
    const fotoRef = comFoto ? dados.fotoRef : null;
    const dataExpurgo = comFoto
      ? new Date(dados.marcadoEm.getTime() + RETENCAO_FOTO_DIAS * 86400000)
          .toISOString()
          .slice(0, 10)
      : null;
    return comRetryUnico(() =>
      this.db.transaction(async (tx) => {
        const r: any = await tx.execute(
          sql`select coalesce(max(nsr),0)+1 as nsr from ponto_marcacao where tenant_id=${tenantId} and equipamento_id=${equipamentoId}`,
        );
        const nsr = Number((r.rows ?? r)[0].nsr);
        const hash = createHash('sha256')
          .update(
            `${tenantId}|${equipamentoId}|${nsr}|${dados.colaboradorId}|${dados.tipo}|${dados.marcadoEm.toISOString()}`,
          )
          .digest('hex')
          .slice(0, 32);
        const [inserted] = await tx
          .insert(pontoMarcacao)
          .values({
            tenantId,
            unidadeId: dados.unidadeId,
            equipamentoId,
            colaboradorId: dados.colaboradorId,
            nsr,
            tipo: dados.tipo,
            marcadoEm: dados.marcadoEm,
            origem: dados.origem,
            registradoPorId: dados.registradoPorId,
            hash,
            obs: dados.obs,
            fotoRef,
            consentimentoLgpd: !!dados.consentimentoLgpd,
            dataExpurgo,
          })
          .returning();
        return inserted;
      }),
    );
  }

  private async comprovante(row: any, colaboradorId: string) {
    const [c] = await this.db
      .select({ nome: colaborador.nome })
      .from(colaborador)
      .where(eq(colaborador.id, colaboradorId));
    return {
      nsr: Number(row.nsr),
      tipo: row.tipo,
      colaboradorId,
      colaboradorNome: c?.nome ?? null,
      marcadoEm: row.marcadoEm,
      hash: row.hash,
      equipamentoId: row.equipamentoId ?? null,
      unidadeId: row.unidadeId ?? null,
    };
  }

  // Notifica o tempo real (gateway WebSocket ouve 'ponto.marcado' e faz o broadcast).
  private emitirMarcado(tenantId: string, comp: any, origem: string) {
    this.events.emit('ponto.marcado', {
      tenantId,
      unidadeId: comp.unidadeId,
      origem,
      comprovante: comp,
    });
  }

  async marcar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: MarcarPontoDto,
    origem = 'web',
    equipamentoId?: string,
  ) {
    const colaboradorId = dto.colaboradorId ?? atorId;
    const row = await this.gravarMarcacao(tenantId, {
      colaboradorId,
      tipo: dto.tipo,
      marcadoEm: new Date(),
      origem,
      registradoPorId: atorId,
      obs: dto.obs,
      unidadeId: dto.unidadeId,
      equipamentoId,
      fotoRef: dto.fotoRef,
      consentimentoLgpd: dto.consentimentoLgpd,
    });
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'ponto',
      acao: 'marcou_ponto',
      entidadeTipo: 'ponto_marcacao',
      entidadeId: row.id,
      detalhe: { tipo: row.tipo, nsr: Number(row.nsr), colaboradorId },
    });
    const comp = await this.comprovante(row, colaboradorId);
    this.emitirMarcado(tenantId, comp, origem);
    return comp;
  }

  // Inclusão manual de marcação esquecida (gestor) — append com origem 'ajuste'.
  async incluirMarcacao(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: IncluirMarcacaoDto,
  ) {
    const row = await this.gravarMarcacao(tenantId, {
      colaboradorId: dto.colaboradorId,
      tipo: dto.tipo,
      marcadoEm: new Date(dto.marcadoEm),
      origem: 'ajuste',
      registradoPorId: atorId,
      obs: dto.justificativa,
      unidadeId: dto.unidadeId,
    });
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'ponto',
      acao: 'incluiu_marcacao',
      entidadeTipo: 'ponto_marcacao',
      entidadeId: row.id,
      detalhe: {
        colaboradorId: dto.colaboradorId,
        tipo: dto.tipo,
        marcadoEm: dto.marcadoEm,
        justificativa: dto.justificativa,
      },
    });
    const comp = await this.comprovante(row, dto.colaboradorId);
    this.emitirMarcado(tenantId, comp, 'ajuste');
    return comp;
  }

  async criarAjuste(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: CriarAjusteDto,
  ) {
    const [row] = await this.db
      .insert(pontoAjuste)
      .values({
        tenantId,
        colaboradorId: dto.colaboradorId,
        data: dto.data,
        tipo: dto.tipo,
        marcacaoId: dto.marcacaoId,
        minutos: dto.minutos,
        justificativa: dto.justificativa,
        atestadoRef: dto.atestadoRef,
        autorId: atorId,
      })
      .returning();
    await this.auditoria.registrar({
      tenantId,
      atorId,
      atorPerfil,
      tipo: 'ponto',
      acao: 'criou_ajuste_ponto',
      entidadeTipo: 'ponto_ajuste',
      entidadeId: row.id,
      detalhe: {
        colaboradorId: dto.colaboradorId,
        data: dto.data,
        tipo: dto.tipo,
        minutos: dto.minutos,
      },
    });
    return row;
  }

  async listarDia(tenantId: string, data: string, colaboradorId?: string) {
    const r: any = await this.db.execute(sql`
      select m.id, m.nsr, m.tipo, m.marcado_em as "marcadoEm", m.origem, m.hash,
        c.nome as "colaboradorNome"
      from ponto_marcacao m
      join colaborador c on c.id = m.colaborador_id
      where m.tenant_id = ${tenantId} and m.marcado_em::date = ${data}
      ${colaboradorId ? sql`and m.colaborador_id = ${colaboradorId}` : sql``}
      order by m.marcado_em asc
    `);
    return (r.rows ?? r).map((x: any) => ({ ...x, nsr: Number(x.nsr) }));
  }

  async espelho(
    tenantId: string,
    colaboradorId: string,
    inicio: string,
    fim: string,
  ) {
    const ms: any = await this.db.execute(sql`
      select id, tipo, nsr, origem, marcado_em as "marcadoEm"
      from ponto_marcacao
      where tenant_id = ${tenantId} and colaborador_id = ${colaboradorId}
        and marcado_em::date between ${inicio} and ${fim}
      order by marcado_em asc
    `);
    const es: any = await this.db.execute(sql`
      select ea.data::text as "data", t.hora_inicio as "inicio", t.hora_fim as "fim"
      from escala_alocacao ea
      join turno t on t.id = ea.turno_id
      where ea.tenant_id = ${tenantId} and ea.colaborador_id = ${colaboradorId}
        and ea.deleted_at is null and ea.data between ${inicio} and ${fim}
    `);
    const aj: any = await this.db.execute(sql`
      select id, data::text as "data", tipo, marcacao_id as "marcacaoId",
        minutos, justificativa, atestado_ref as "atestadoRef"
      from ponto_ajuste
      where tenant_id = ${tenantId} and colaborador_id = ${colaboradorId}
        and data between ${inicio} and ${fim}
      order by created_at asc
    `);
    const fe: any = await this.db.execute(sql`
      select data::text as "data" from feriado
      where tenant_id = ${tenantId} and data between ${inicio} and ${fim}
    `);
    const feriados = new Set<string>((fe.rows ?? fe).map((f: any) => f.data));
    const ajustes = aj.rows ?? aj;
    const desconsid = new Set(
      ajustes
        .filter((a: any) => a.tipo === 'desconsideracao' && a.marcacaoId)
        .map((a: any) => a.marcacaoId),
    );

    const dias: Record<
      string,
      { marcacoes: any[]; esperadoMin: number; ajustes: any[] }
    > = {};
    for (const m of ms.rows ?? ms) {
      const d = new Date(m.marcadoEm).toISOString().slice(0, 10);
      (dias[d] ??= { marcacoes: [], esperadoMin: 0, ajustes: [] }).marcacoes.push({
        ...m,
        desconsiderada: desconsid.has(m.id),
      });
    }
    for (const e of es.rows ?? es) {
      (dias[e.data] ??= { marcacoes: [], esperadoMin: 0, ajustes: [] }).esperadoMin +=
        turnoMin(String(e.inicio), String(e.fim));
    }
    for (const a of ajustes) {
      (dias[a.data] ??= { marcacoes: [], esperadoMin: 0, ajustes: [] }).ajustes.push(
        a,
      );
    }

    const out = Object.entries(dias)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, v]) => {
        const validas = v.marcacoes.filter((m: any) => !m.desconsiderada);
        const trabalhadoMin = minutosTrabalhados(validas);
        const abonoMin = v.ajustes
          .filter((a: any) => a.tipo === 'abono' || a.tipo === 'atestado')
          .reduce(
            (s: number, a: any) => s + (a.minutos ?? v.esperadoMin),
            0,
          );
        const efetivoMin = trabalhadoMin + abonoMin;
        // Prévia gerencial (§3): extra só quando há jornada prevista; fator
        // 100% em domingo/feriado, 50% em dia útil; noturno = faixa 22h–5h.
        const domFer = new Date(data + 'T12:00:00Z').getUTCDay() === 0 || feriados.has(data);
        const fatorExtra = fatorHoraExtra(domFer);
        const extraMin =
          v.esperadoMin > 0 ? Math.max(0, trabalhadoMin - v.esperadoMin) : 0;
        const noturnoMin = minutosNoturnos(validas);
        return {
          data,
          esperadoMin: v.esperadoMin,
          trabalhadoMin,
          abonoMin,
          efetivoMin,
          extraMin,
          fatorExtraPct: Math.round(fatorExtra * 100),
          noturnoMin,
          saldoMin: efetivoMin - v.esperadoMin,
          marcacoes: v.marcacoes.map((m: any) => ({
            id: m.id,
            tipo: m.tipo,
            nsr: Number(m.nsr),
            origem: m.origem,
            desconsiderada: m.desconsiderada,
            hora: new Date(m.marcadoEm).toISOString(),
          })),
          ajustes: v.ajustes.map((a: any) => ({
            id: a.id,
            tipo: a.tipo,
            minutos: a.minutos,
            justificativa: a.justificativa,
            atestadoRef: a.atestadoRef,
          })),
        };
      });

    const totalTrabalhadoMin = out.reduce((s, d) => s + d.efetivoMin, 0);
    const totalEsperadoMin = out.reduce((s, d) => s + d.esperadoMin, 0);
    const totalExtraMin = out.reduce((s, d) => s + d.extraMin, 0);
    const totalNoturnoMin = out.reduce((s, d) => s + d.noturnoMin, 0);
    // DSR sobre extras (estimativa §3): média diária de extra em dias úteis
    // trabalhados × nº de domingos/feriados do período. Confira na contabilidade.
    const diasUteisTrab = out.filter(
      (d) => d.fatorExtraPct === 50 && d.esperadoMin > 0,
    ).length;
    const domFerCount = out.filter((d) => d.fatorExtraPct === 100).length;
    const dsrEstimadoMin =
      diasUteisTrab > 0
        ? Math.round((totalExtraMin / diasUteisTrab) * domFerCount)
        : 0;
    return {
      colaboradorId,
      inicio,
      fim,
      dias: out,
      totalTrabalhadoMin,
      totalEsperadoMin,
      totalExtraMin,
      totalNoturnoMin,
      dsrEstimadoMin,
      saldoMin: totalTrabalhadoMin - totalEsperadoMin,
    };
  }

  async pessoas(tenantId: string, data: string) {
    const ms: any = await this.db.execute(sql`
      select m.colaborador_id as "colaboradorId", c.nome, m.tipo,
        m.marcado_em as "marcadoEm"
      from ponto_marcacao m
      join colaborador c on c.id = m.colaborador_id
      where m.tenant_id = ${tenantId} and m.marcado_em::date = ${data}
      order by m.marcado_em asc
    `);
    const by: Record<string, any> = {};
    for (const m of ms.rows ?? ms) {
      (by[m.colaboradorId] ??= {
        colaboradorId: m.colaboradorId,
        nome: m.nome,
        marcacoes: [],
      }).marcacoes.push(m);
    }
    return Object.values(by)
      .map((p: any) => {
        const last = p.marcacoes[p.marcacoes.length - 1];
        return {
          colaboradorId: p.colaboradorId,
          nome: p.nome,
          marcacoes: p.marcacoes.length,
          primeiraEntrada: p.marcacoes[0]
            ? new Date(p.marcacoes[0].marcadoEm).toISOString()
            : null,
          ultimaMarcacao: last
            ? { tipo: last.tipo, hora: new Date(last.marcadoEm).toISOString() }
            : null,
          trabalhadoMin: minutosTrabalhados(p.marcacoes),
          status: last && ENTRA.has(last.tipo) ? 'trabalhando' : 'fora',
        };
      })
      .sort((a: any, b: any) => a.nome.localeCompare(b.nome));
  }
}
