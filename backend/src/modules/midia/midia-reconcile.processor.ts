import { ehServidorLocal } from '../../common/modo';
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
 * O endereço de uma mídia LOCAL, para o `where` — a MESMA regra do `MidiaService.ehUrlLocal` (o midia-reconcile.spec
 * confere as duas com os mesmos endereços): termina em `<empresa>/<arquivo>.<jpg|png|webp|gif>`, os dois em formato de
 * uuid, com barras e `?consulta` opcionais no fim. O que já está no storage da nuvem fica de fora no próprio `where`.
 */
export const PADRAO_DA_MIDIA_LOCAL = '/[0-9a-fA-F-]{36}/[0-9a-fA-F-]{36}\\.(jpg|png|webp|gif)/*(\\?.*)?$';
const ZERO = '00000000-0000-0000-0000-000000000000';

/**
 * P4 (modo híbrido) — no EDGE, as imagens do catálogo são gravadas em disco local na
 * hora (offline-first). Este processo replica cada imagem local para a NUVEM (Supabase)
 * e reescreve o `imagem_ref` para a URL pública → o cardápio ONLINE passa a exibir a
 * imagem, e a nova ref SOBE pelo sync (updated_at bumpado). Só roda no edge com nuvem
 * configurada; se estiver offline no momento, tenta de novo no próximo ciclo.
 *
 * A FILA NÃO TRANCA (V84). Antes o lote eram 25 linhas QUAISQUER que não fossem do storage, e o que não era arquivo
 * local era pulado no laço: a imagem com endereço de fora (a do catálogo importado de outro sistema — medido na nuvem em
 * 16/11/2026: 68 produtos com a imagem em outro servidor) ocupava o lote inteiro a cada ciclo, e a foto enviada pela
 * loja nunca subia — o cardápio online ficava com a imagem quebrada. Agora (1) o `where` só traz o que É arquivo local
 * e (2) o lote anda em RODÍZIO pelo id: o arquivo que sumiu do disco (nunca vai subir) não fica na frente dos outros.
 */
@Injectable()
export class MidiaReconcileProcessor {
  private readonly logger = new Logger('MidiaReconcile');
  private readonly isEdge = ehServidorLocal();
  private rodando = false;
  /** Linhas por tabela a cada ciclo (o teste diminui para provar o rodízio). */
  lote = 25;
  /** Por tabela: o último id visto — o ciclo seguinte continua dali; a página curta recomeça do início. */
  private readonly depoisDe = new Map<string, string>();

  constructor(
    @Inject(DRIZZLE) private readonly db: DrizzleDB,
    private readonly midia: MidiaService,
  ) {}

  /** `soEmpresas`: só para o teste (no CI as specs dividem o banco). Vale apenas como LISTA — o `@Interval` não passa nada. */
  @Interval(90_000)
  async reconciliar(soEmpresas?: string[]) {
    // Replica via NUVEM (posta no endpoint com sync-token) — o edge NÃO precisa da
    // service key do Supabase. Basta ter CLOUD_API + SYNC_TOKEN.
    if (!this.isEdge || !this.midia.temCloud() || this.rodando) return;
    this.rodando = true;
    const empresas =
      Array.isArray(soEmpresas) && soEmpresas.length
        ? sql`and tenant_id in (${sql.join(soEmpresas.map((t) => sql`${t}::uuid`), sql`, `)})`
        : sql``;
    try {
      for (const alvo of ALVOS) {
        const col = sql.raw(alvo.col);
        const tabela = sql.raw(alvo.tabela);
        const cursor = this.depoisDe.get(alvo.tabela) ?? ZERO;
        // Só o que É arquivo local (a mesma regra do `ehUrlLocal`), em ordem, a partir de onde o ciclo anterior parou.
        const res: any = await this.db.execute(sql`
          select id, ${col} as ref
          from ${tabela}
          where ${col} ~ ${PADRAO_DA_MIDIA_LOCAL}
            and ${col} not like '%/storage/v1/object/public/%'
            and id > ${cursor}::uuid ${empresas}
          order by id
          limit ${this.lote}
        `);
        const linhas = (res.rows ?? res) as any[];
        this.depoisDe.set(alvo.tabela, linhas.length < this.lote ? ZERO : String(linhas[linhas.length - 1].id));
        for (const l of linhas) {
          if (!this.midia.ehUrlLocal(l.ref)) continue; // conferência em dobro: o `where` já traz só o que é local
          const novo = await this.midia.replicarViaNuvem(l.ref).catch(() => null);
          if (!novo) continue; // sem internet ou o arquivo sumiu → a vez dela volta no rodízio
          // Só troca se a imagem ainda é a que subiu: quem mudou a foto nesse meio-tempo não perde a nova.
          await this.db.execute(sql`
            update ${tabela}
            set ${col} = ${novo}, updated_at = now()
            where id = ${l.id} and ${col} = ${l.ref}
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
