import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { auditLog } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Serialização estável (chaves ordenadas) — o hash não pode depender da ordem de
// chaves que o jsonb devolve, senão a verificação daria falso-positivo.
function stable(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
  return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
}
// Forma canônica de um registro (SEM created_at — a integridade do relógio é
// controle separado; o seq já dá a ordem). hash = sha256(prev_hash | canônico).
function canonico(r: {
  tenantId: string; seq: number; unidadeId?: any; atorId?: any; atorPerfil?: any;
  tipo?: any; acao?: any; entidadeTipo?: any; entidadeId?: any; detalhe?: any; origem?: any;
}): string {
  return stable({
    t: r.tenantId, s: r.seq, u: r.unidadeId ?? null,
    ai: r.atorId ?? null, ap: r.atorPerfil ?? null,
    ti: r.tipo ?? null, ac: r.acao ?? null,
    et: r.entidadeTipo ?? null, ei: r.entidadeId ?? null,
    d: r.detalhe ?? null, o: r.origem ?? 'web',
  });
}

export type AuditEntry = {
  tenantId: string;
  atorId?: string | null;
  atorPerfil?: string | null;
  tipo: string;
  acao: string;
  detalhe?: any;
  origem?: string;
  unidadeId?: string | null;
  entidadeTipo?: string | null;
  entidadeId?: string | null;
};

@Injectable()
export class AuditoriaService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Registro imutável, ENCADEADO (append-only + hash-chain). Nunca deve derrubar a
  // operação principal. Um advisory lock por-tenant serializa a cadeia (sem fork em
  // inserts concorrentes); seq monotônico + hash do anterior tornam remoção/alteração
  // detectáveis por `verificarCadeia`.
  async registrar(e: AuditEntry) {
    try {
      await this.db.transaction(async (tx) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${e.tenantId}), 0)`);
        const prevRes: any = await tx.execute(sql`
          select seq, hash from audit_log
          where tenant_id = ${e.tenantId} and seq is not null
          order by seq desc limit 1`);
        const prev = (prevRes.rows ?? prevRes)[0];
        const seq = (Number(prev?.seq) || 0) + 1;
        const prevHash: string = prev?.hash ?? '';
        const hash = createHash('sha256')
          .update(prevHash + '|' + canonico({ ...e, seq }))
          .digest('hex');
        await tx.insert(auditLog).values({
          tenantId: e.tenantId,
          unidadeId: e.unidadeId ?? undefined,
          actorId: e.atorId ?? undefined,
          actorPerfil: e.atorPerfil ?? undefined,
          tipo: e.tipo,
          acao: e.acao,
          detalhe: e.detalhe ?? undefined,
          entidadeTipo: e.entidadeTipo ?? undefined,
          entidadeId: e.entidadeId ?? undefined,
          origem: e.origem ?? 'web',
          seq,
          prevHash,
          hash,
        });
      });
    } catch {
      /* auditoria não pode quebrar a operação */
    }
  }

  // Verifica a cadeia de um tenant: recomputa cada hash e confere o encadeamento e a
  // continuidade do seq. Retorna as quebras (adulteração/remoção/reordenação).
  async verificarCadeia(tenantId: string): Promise<{ ok: boolean; total: number; quebras: any[] }> {
    const res: any = await this.db.execute(sql`
      select seq, prev_hash as "prevHash", hash, tenant_id as "tenantId", unidade_id as "unidadeId",
             actor_id as "atorId", actor_perfil as "atorPerfil", tipo, acao,
             entidade_tipo as "entidadeTipo", entidade_id as "entidadeId", detalhe, origem
      from audit_log where tenant_id = ${tenantId} and seq is not null order by seq asc`);
    const rows = res.rows ?? res;
    const quebras: any[] = [];
    let prevHash = '';
    let esperado = 1;
    for (const r of rows) {
      const seq = Number(r.seq);
      if (seq !== esperado) quebras.push({ seq, motivo: `seq fora de sequência (esperado ${esperado}) — possível remoção` });
      esperado = seq + 1;
      const h = createHash('sha256').update((r.prevHash ?? '') + '|' + canonico({ ...r, seq })).digest('hex');
      if (h !== r.hash) quebras.push({ seq, motivo: 'hash não confere — registro adulterado' });
      if ((r.prevHash ?? '') !== prevHash) quebras.push({ seq, motivo: 'prev_hash não encadeia — registro removido/reordenado' });
      prevHash = r.hash;
    }
    return { ok: quebras.length === 0, total: rows.length, quebras };
  }

  private async rows(q: any): Promise<any[]> {
    const r: any = await this.db.execute(q);
    return r.rows ?? r;
  }

  // Trilha filtrável: tipo + busca (ator/ação/tipo/detalhe) + período (de/até).
  // Devolve os registros e os tipos distintos existentes (para os chips do front).
  async listar(
    tenantId: string,
    f: { tipo?: string; busca?: string; de?: string; ate?: string } = {},
  ) {
    const cond = [sql`a.tenant_id = ${tenantId}`];
    if (f.tipo) cond.push(sql`a.tipo = ${f.tipo}`);
    if (f.de) cond.push(sql`a.created_at::date >= ${f.de}`);
    if (f.ate) cond.push(sql`a.created_at::date <= ${f.ate}`);
    if (f.busca?.trim()) {
      const q = `%${f.busca.trim().toLowerCase()}%`;
      cond.push(sql`(
        lower(coalesce(c.nome,'')) like ${q}
        or lower(a.acao) like ${q}
        or lower(coalesce(a.tipo,'')) like ${q}
        or lower(coalesce(a.detalhe::text,'')) like ${q}
      )`);
    }
    const where = sql.join(cond, sql` and `);

    const registros = await this.rows(sql`
      select a.id, a.tipo, a.acao, a.detalhe,
             a.actor_id as "atorId", a.actor_perfil as "atorPerfil", a.origem,
             a.created_at as "criadoEm", c.nome as "atorNome"
      from audit_log a
      left join colaborador c on c.id = a.actor_id
      where ${where}
      order by a.created_at desc
      limit 300
    `);
    const tipos = await this.rows(sql`
      select distinct tipo from audit_log
      where tenant_id = ${tenantId} and tipo is not null and tipo <> ''
      order by tipo`);
    return { registros, tipos: tipos.map((t) => t.tipo as string) };
  }
}
