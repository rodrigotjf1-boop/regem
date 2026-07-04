import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { TABELAS_PULL } from './sync-config';

@Injectable()
export class SyncService {
  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  // Deltas de controle (desce/ambos) desde o cursor, escopados ao tenant.
  // Identificadores (tabela/cursor) vêm da whitelist TABELAS_PULL — nunca do usuário.
  async pull(tenantId: string, desde?: string) {
    const desdeTs = desde || '1970-01-01T00:00:00Z';
    const tabelas: Record<string, any[]> = {};
    let maxCursor = desdeTs;

    for (const t of TABELAS_PULL) {
      const r: any = await this.db.execute(sql`
        select * from ${sql.raw(t.tabela)}
        where tenant_id = ${tenantId} and ${sql.raw(t.cursor)} > ${desdeTs}
        order by ${sql.raw(t.cursor)} asc
        limit 1000
      `);
      const rows = r.rows ?? r;
      tabelas[t.tabela] = rows;
      for (const row of rows) {
        const c = row[t.cursor];
        if (c && new Date(c) > new Date(maxCursor)) maxCursor = c;
      }
    }

    return {
      serverTime: new Date().toISOString(),
      desde: desdeTs,
      proximoCursor: maxCursor, // o servidor local guarda e manda como `desde` no próximo pull
      tabelas,
    };
  }
}
