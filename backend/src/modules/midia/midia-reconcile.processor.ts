import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { sql } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { MidiaService } from './midia.service';

// Colunas de imagem do catálogo que o edge reconcilia (local → nuvem).
const ALVOS: { tabela: string; col: string }[] = [
  { tabela: 'produto', col: 'imagem_ref' },
  { tabela: 'categoria_produto', col: 'imagem_ref' },
  { tabela: 'opcao', col: 'imagem_ref' },
  { tabela: 'cardapio_config', col: 'logo_ref' },
];

/**
 * P4 (modo híbrido) — no EDGE, as imagens do catálogo são gravadas em disco local na
 * hora (offline-first). Este processo replica cada imagem local para a NUVEM (Supabase)
 * e reescreve o `imagem_ref` para a URL pública → o cardápio ONLINE passa a exibir a
 * imagem, e a nova ref SOBE pelo sync (updated_at bumpado). Só roda no edge com nuvem
 * configurada; se estiver offline no momento, tenta de novo no próximo ciclo.
 */
@Injectable()
export class MidiaReconcileProcessor {
  private readonly logger = new Logger('MidiaReconcile');
  private readonly isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  private rodando = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly midia: MidiaService,
  ) {}

  @Interval(90_000)
  async reconciliar() {
    if (!this.isEdge || !this.midia.temNuvem() || this.rodando) return;
    this.rodando = true;
    try {
      for (const alvo of ALVOS) {
        // Refs preenchidas que ainda NÃO são URL da nuvem (candidatas a subir).
        const res: any = await this.db.execute(sql`
          select id, ${sql.raw(alvo.col)} as ref
          from ${sql.raw(alvo.tabela)}
          where ${sql.raw(alvo.col)} is not null
            and ${sql.raw(alvo.col)} <> ''
            and ${sql.raw(alvo.col)} not like '%/storage/v1/object/public/%'
          limit 25
        `);
        for (const l of (res.rows ?? res) as any[]) {
          if (!this.midia.ehUrlLocal(l.ref)) continue; // não é arquivo local nosso
          const novo = await this.midia.reconciliarParaNuvem(l.ref).catch(() => null);
          if (!novo) continue; // offline/arquivo sumiu → próximo ciclo
          await this.db.execute(sql`
            update ${sql.raw(alvo.tabela)}
            set ${sql.raw(alvo.col)} = ${novo}, updated_at = now()
            where id = ${l.id}
          `);
          this.logger.log(`${alvo.tabela}#${l.id}: imagem local → nuvem`);
        }
      }
    } catch (e: any) {
      this.logger.warn(`reconcile falhou: ${e?.message ?? e}`);
    } finally {
      this.rodando = false;
    }
  }
}
