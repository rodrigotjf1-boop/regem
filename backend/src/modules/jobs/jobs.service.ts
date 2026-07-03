import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { MidiaService } from '../midia/midia.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Agendador de jobs do backend. (Instância única no EasyPanel — sem lock distribuído.)
@Injectable()
export class JobsService {
  private readonly log = new Logger('Jobs');

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly midia: MidiaService,
  ) {}

  // Expurgo LGPD: apaga do storage as fotos de ponto vencidas (data_expurgo < hoje).
  @Cron('0 3 * * *') // 03:00 todos os dias
  async expurgarFotosPonto() {
    const r: any = await this.db.execute(sql`
      select id, foto_ref as "fotoRef" from ponto_marcacao
      where foto_ref is not null and data_expurgo is not null
        and data_expurgo < current_date
      limit 500
    `);
    const rows = r.rows ?? r;
    if (!rows.length) return;
    let apagadas = 0;
    for (const row of rows) {
      const ok = await this.midia.remover(row.fotoRef);
      // Zera a referência mesmo se o storage falhar — evita reprocessar sem fim.
      await this.db.execute(
        sql`update ponto_marcacao set foto_ref = null where id = ${row.id}`,
      );
      if (ok) apagadas++;
    }
    this.log.log(
      `Expurgo LGPD: ${apagadas}/${rows.length} fotos de ponto removidas do storage`,
    );
  }
}
