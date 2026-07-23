import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Food99Service } from './food99.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Poller da nuvem para o 99food. O 99food NÃO tem endpoint de "listar pedidos"
// (pedidos novos chegam só por webhook), então este poller NÃO descobre pedidos —
// ele apenas RECONCILIA os cancelamentos pendentes (blindagem): reenvia o
// requestCancellation dos pedidos cujo cancel não foi aceito, com backoff, até o
// 99food confirmar (errno 0). Não roda no EDGE (integração é cloud-first).
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
        } catch (e: any) {
          this.logger.error(`poller 99food loja ${ig.appShopId}: ${e?.message ?? e}`, e?.stack);
        }
      }
    } finally {
      this.rodando = false;
    }
  }
}
