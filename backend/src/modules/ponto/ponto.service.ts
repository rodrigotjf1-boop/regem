import { Inject, Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { createHash } from 'crypto';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { pontoMarcacao, colaborador } from '../../db/schema';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { MarcarPontoDto } from './dto/marcar-ponto.dto';

/* eslint-disable @typescript-eslint/no-explicit-any */
const ENTRA = new Set(['entrada', 'intervalo_fim']);
const SAI = new Set(['saida', 'intervalo_inicio']);

// Minutos trabalhados a partir das marcações (pareia in→out; intervalo desconta).
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

// Duração de um turno "HH:MM[:SS]" em minutos (trata virada de meia-noite).
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
  ) {}

  // Registro imutável: NSR sequencial por tenant (com retry no choque de índice único).
  async marcar(
    tenantId: string,
    atorId: string,
    atorPerfil: string,
    dto: MarcarPontoDto,
    origem = 'web',
  ) {
    const colaboradorId = dto.colaboradorId ?? atorId;
    let tentativa = 0;
    let row: any;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        row = await this.db.transaction(async (tx) => {
          const r: any = await tx.execute(
            sql`select coalesce(max(nsr),0)+1 as nsr from ponto_marcacao where tenant_id=${tenantId}`,
          );
          const nsr = Number((r.rows ?? r)[0].nsr);
          const marcadoEm = new Date();
          const hash = createHash('sha256')
            .update(
              `${tenantId}|${nsr}|${colaboradorId}|${dto.tipo}|${marcadoEm.toISOString()}`,
            )
            .digest('hex')
            .slice(0, 32);
          const [inserted] = await tx
            .insert(pontoMarcacao)
            .values({
              tenantId,
              unidadeId: dto.unidadeId,
              colaboradorId,
              nsr,
              tipo: dto.tipo,
              marcadoEm,
              origem,
              registradoPorId: atorId,
              hash,
              obs: dto.obs,
            })
            .returning();
          return inserted;
        });
        break;
      } catch (e: any) {
        if (e?.code === '23505' && tentativa < 4) {
          tentativa++;
          continue;
        }
        throw e;
      }
    }

    const [c] = await this.db
      .select({ nome: colaborador.nome })
      .from(colaborador)
      .where(eq(colaborador.id, colaboradorId));

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

    // Comprovante (lógica 671: NSR + identificação + horário + assinatura).
    return {
      nsr: Number(row.nsr),
      tipo: row.tipo,
      colaboradorId,
      colaboradorNome: c?.nome ?? null,
      marcadoEm: row.marcadoEm,
      hash: row.hash,
    };
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
      select tipo, nsr, marcado_em as "marcadoEm"
      from ponto_marcacao
      where tenant_id = ${tenantId} and colaborador_id = ${colaboradorId}
        and marcado_em::date between ${inicio} and ${fim}
      order by marcado_em asc
    `);
    const es: any = await this.db.execute(sql`
      select ea.data, t.hora_inicio as "inicio", t.hora_fim as "fim"
      from escala_alocacao ea
      join turno t on t.id = ea.turno_id
      where ea.tenant_id = ${tenantId} and ea.colaborador_id = ${colaboradorId}
        and ea.deleted_at is null and ea.data between ${inicio} and ${fim}
    `);

    const dias: Record<string, { marcacoes: any[]; esperadoMin: number }> = {};
    for (const m of ms.rows ?? ms) {
      const d = new Date(m.marcadoEm).toISOString().slice(0, 10);
      (dias[d] ??= { marcacoes: [], esperadoMin: 0 }).marcacoes.push(m);
    }
    for (const e of es.rows ?? es) {
      const d =
        typeof e.data === 'string'
          ? e.data
          : new Date(e.data).toISOString().slice(0, 10);
      (dias[d] ??= { marcacoes: [], esperadoMin: 0 }).esperadoMin += turnoMin(
        String(e.inicio),
        String(e.fim),
      );
    }

    const out = Object.entries(dias)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([data, v]) => {
        const trabalhadoMin = minutosTrabalhados(v.marcacoes);
        return {
          data,
          esperadoMin: v.esperadoMin,
          trabalhadoMin,
          saldoMin: trabalhadoMin - v.esperadoMin,
          marcacoes: v.marcacoes.map((m: any) => ({
            tipo: m.tipo,
            nsr: Number(m.nsr),
            hora: new Date(m.marcadoEm).toISOString(),
          })),
        };
      });

    const totalTrabalhadoMin = out.reduce((s, d) => s + d.trabalhadoMin, 0);
    const totalEsperadoMin = out.reduce((s, d) => s + d.esperadoMin, 0);
    return {
      colaboradorId,
      inicio,
      fim,
      dias: out,
      totalTrabalhadoMin,
      totalEsperadoMin,
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
