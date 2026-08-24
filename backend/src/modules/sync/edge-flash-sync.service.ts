import { Global, Inject, Injectable, Logger, Module } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DRIZZLE, DrizzleDB } from '../../db/drizzle.module';
import { produto, pedidoExterno } from '../../db/schema';

/**
 * Flash-sync (P3/híbrido): push IMEDIATO de produtos para a nuvem, fora do ciclo do
 * daemon (~30s). Usado quando a disponibilidade muda no edge (esgotou o estoque,
 * pausa manual, edição) — o cardápio ONLINE precisa refletir em segundos para
 * bloquear novos pedidos do item. Best-effort: se a nuvem estiver fora, o daemon
 * periódico recupera. Só roda no EDGE (EDGE_MODE) e quando há CLOUD_API + SYNC_TOKEN.
 */
@Injectable()
export class EdgeFlashSyncService {
  private readonly logger = new Logger('FlashSync');
  private readonly isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  private readonly cloud = (process.env.CLOUD_API ?? '').replace(/\/$/, '');
  private readonly token = process.env.SYNC_TOKEN ?? '';

  constructor(@Inject(DRIZZLE) private readonly db: DrizzleDB) {}

  get ligado(): boolean {
    return this.isEdge && !!this.cloud && !!this.token;
  }

  // Empurra os produtos (por id) para a nuvem agora. Não lança — nunca deve
  // atrapalhar a operação local; o sync periódico é a rede de segurança.
  async flashProdutos(ids: string[]): Promise<void> {
    if (!this.ligado || !ids?.length) return;
    // Dispara sem bloquear o chamador (a UI não espera o round-trip da nuvem).
    void (async () => {
      try {
        const linhas = await this.db.select().from(produto).where(inArray(produto.id, ids));
        if (!linhas.length) return;
        const res = await fetch(`${this.cloud}/sync/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sync-token': this.token },
          body: JSON.stringify({ lotes: [{ tabela: 'produto', linhas }] }),
        });
        if (!res.ok) this.logger.warn(`flash push HTTP ${res.status}`);
        else this.logger.log(`flash: ${linhas.length} produto(s) → cardápio online`);
      } catch (e: any) {
        this.logger.warn(`flash falhou (daemon recupera no ciclo): ${e?.message ?? e}`);
      }
    })();
  }

  // Push IMEDIATO de pedidos (por id) para a nuvem — usado nas mudanças de STATUS
  // (pronto/despachado/entregue/concluído) para o app do entregador (só nuvem) ver a
  // transição em segundos, não no ciclo de ~60s. Best-effort; o daemon é a rede de segurança.
  async flashPedidos(ids: string[]): Promise<void> {
    if (!this.ligado || !ids?.length) return;
    void (async () => {
      try {
        const linhas = await this.db.select().from(pedidoExterno).where(inArray(pedidoExterno.id, ids));
        if (!linhas.length) return;
        const res = await fetch(`${this.cloud}/sync/push`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-sync-token': this.token },
          body: JSON.stringify({ lotes: [{ tabela: 'pedido_externo', linhas }] }),
        });
        if (!res.ok) this.logger.warn(`flash pedido push HTTP ${res.status}`);
        else this.logger.log(`flash: ${linhas.length} pedido(s) → nuvem`);
      } catch (e: any) {
        this.logger.warn(`flash pedido falhou (daemon recupera no ciclo): ${e?.message ?? e}`);
      }
    })();
  }
}

@Global()
@Module({
  providers: [EdgeFlashSyncService],
  exports: [EdgeFlashSyncService],
})
export class EdgeFlashSyncModule {}
