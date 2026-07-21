import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CardapioWebService } from './cardapio-web.service';

// Poller da nuvem: a cada 30s puxa os pedidos novos de cada loja com integração
// Cardápio Web ativa (via cursor lastPollAt). É o "tempo real" prático enquanto
// o webhook (que exige URL pública) não está configurado; os dois convivem
// (a ingestão é idempotente por externalId). Não roda no EDGE — pedidos online
// nascem na nuvem e descem pelo sync.
@Injectable()
export class CardapioWebPoller {
  private readonly logger = new Logger('CardapioWebPoller');
  private rodando = false;
  constructor(private readonly cw: CardapioWebService) {}

  @Interval(30000)
  async tick() {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return;
    if (this.rodando) return; // evita sobreposição se um ciclo demorar
    this.rodando = true;
    try {
      const integs = await this.cw.integracoesAtivasCw();
      for (const ig of integs) {
        try {
          const n = await this.cw.sincronizar(ig.tenantId);
          if (n) this.logger.log(`tenant ${ig.tenantId}: ${n} pedido(s) novo(s)`);
        } catch (e: any) {
          this.logger.warn(`tenant ${ig.tenantId}: ${e?.message ?? e}`);
        }
      }
    } finally {
      this.rodando = false;
    }
  }
}
