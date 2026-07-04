import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { TABELAS_PULL, TABELAS_PUSH, REDIGIR } from './sync-config';
import { LoteSyncDto } from './dto/push.dto';

@Injectable()
export class SyncService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}
  private colunasCache = new Map<string, Set<string>>();

  // Colunas reais da tabela (whitelist por introspecção — nada de coluna arbitrária).
  private async colunasDe(tabela: string): Promise<Set<string>> {
    const cache = this.colunasCache.get(tabela);
    if (cache) return cache;
    const r: any = await this.db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = ${tabela}
    `);
    const set = new Set<string>((r.rows ?? r).map((x: any) => x.column_name));
    this.colunasCache.set(tabela, set);
    return set;
  }

  // Deltas de controle (desce/ambos) desde o cursor, escopados ao tenant.
  // Identificadores (tabela/cursor) vêm da whitelist TABELAS_PULL — nunca do usuário.
  async pull(tenantId: string, desde?: string) {
    const desdeTs = desde || '1970-01-01T00:00:00Z';
    const tabelas: Record<string, any[]> = {};
    let maxCursor = desdeTs;

    for (const t of TABELAS_PULL) {
      const r: any = await this.db.execute(sql`
        select * from ${sql.identifier(t.tabela)}
        where tenant_id = ${tenantId} and ${sql.identifier(t.cursor)} > ${desdeTs}
        order by ${sql.identifier(t.cursor)} asc
        limit 1000
      `);
      const rows = r.rows ?? r;
      const segredos = REDIGIR[t.tabela];
      const limpas = segredos
        ? rows.map((row: any) => {
            const c = { ...row };
            for (const s of segredos) delete c[s];
            return c;
          })
        : rows;
      tabelas[t.tabela] = limpas;
      for (const row of rows) {
        const c = row[t.cursor];
        if (c && new Date(c) > new Date(maxCursor)) maxCursor = c;
      }
    }

    return {
      serverTime: new Date().toISOString(),
      desde: desdeTs,
      proximoCursor: maxCursor,
      tabelas,
    };
  }

  // Ingestão do operacional (local → nuvem). Seguro:
  // - tabela na whitelist TABELAS_PUSH (append-only);
  // - tenant_id FORÇADO ao do token (ignora o que vier na linha);
  // - só colunas reais (introspecção); jsonb serializado;
  // - idempotente: on conflict (id) do nothing + trata unique (23505).
  async push(tenantId: string, lotes: LoteSyncDto[]) {
    const resultado: Record<string, { inseridas: number; ignoradas: number }> = {};

    for (const lote of lotes) {
      if (!TABELAS_PUSH.has(lote.tabela)) {
        throw new BadRequestException(`Tabela não permitida no push: ${lote.tabela}`);
      }
      const colunas = await this.colunasDe(lote.tabela);
      let inseridas = 0;
      let ignoradas = 0;

      for (const linha of lote.linhas ?? []) {
        if (!linha || typeof linha !== 'object' || !linha.id) {
          ignoradas++;
          continue;
        }
        const cols = Object.keys(linha).filter(
          (k) => colunas.has(k) && k !== 'tenant_id',
        );
        const nomes = ['tenant_id', ...cols];
        const valores = [tenantId, ...cols.map((c) => coagir((linha as any)[c]))];

        try {
          const r: any = await this.db.execute(sql`
            insert into ${sql.identifier(lote.tabela)} (
              ${sql.join(nomes.map((n) => sql.identifier(n)), sql`, `)}
            ) values (
              ${sql.join(valores.map((v) => sql`${v}`), sql`, `)}
            ) on conflict (id) do nothing
          `);
          if ((r?.rowCount ?? 0) > 0) inseridas++;
          else ignoradas++;
        } catch (e: any) {
          if (e?.code === '23505') {
            ignoradas++;
            continue;
          }
          throw e;
        }
      }
      resultado[lote.tabela] = { inseridas, ignoradas };
    }

    return { serverTime: new Date().toISOString(), resultado };
  }
}

// jsonb/arrays viram string; o resto passa como está (pg casta pelo tipo da coluna).
function coagir(v: unknown): unknown {
  if (v !== null && typeof v === 'object') return JSON.stringify(v);
  return v;
}
