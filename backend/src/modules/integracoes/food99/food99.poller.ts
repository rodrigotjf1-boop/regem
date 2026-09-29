import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Food99Service } from './food99.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Poller da nuvem para o 99food. O 99food NÃO tem endpoint de "listar pedidos"
// (pedidos novos chegam só por webhook), então este poller NÃO descobre pedidos —
// ele RECONCILIA: (1) os cancelamentos pendentes (blindagem): reenvia o
// requestCancellation dos pedidos cujo cancel não foi aceito, com backoff, até o
// 99food confirmar (errno 0); (2) o "saiu para entrega" da ENTREGA DA LOJA (mig 294):
// avisa a 99 dos pedidos despachados — inclusive os despachados no servidor da loja,
// onde a integração não existe. Não roda no EDGE (integração é cloud-first).
@Injectable()
export class Food99Poller {
  private readonly logger = new Logger('Food99Poller');
  private rodando = false;
  constructor(private readonly food99: Food99Service) {}

  @Interval(30000)
  async tick() {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return;
    if (this.rodando) return; // evita sobreposição
    this.rodando = true;
    try {
      const integs = await this.food99.integracoesAtivas();
      for (const ig of integs) {
        try {
          const n = await this.food99.reconciliarCancels(ig);
          if (n) this.logger.log(`loja ${ig.appShopId}: ${n} cancelamento(s) reconciliado(s)`);
          const d = await this.food99.reconciliarDespachos(ig);
          if (d) this.logger.log(`loja ${ig.appShopId}: ${d} saída(s) para entrega avisada(s) à 99`);
        } catch (e: any) {
          this.logger.error(`poller 99food loja ${ig.appShopId}: ${e?.message ?? e}`, e?.stack);
        }
      }
    } finally {
      this.rodando = false;
    }
  }
}
