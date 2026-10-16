import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { FalhasDoPoller } from '../../../common/falhas-do-poller';
import { AnotaAiService } from './anotaai.service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Poller da nuvem: a cada 30s puxa os pedidos novos de cada loja Anota Aí ativa
// (PING - LIST ORDERS → ingest → aceita). É o "tempo real" prático da Anota Aí
// (também há webhook, mas o polling não exige URL pública). Não roda no EDGE —
// pedidos online nascem na nuvem e descem pelo sync.
@Injectable()
export class AnotaAiPoller {
  private readonly logger = new Logger('AnotaAiPoller');
  // Falha de rede passageira = aviso; erro só se a loja ficar 5 min sem resposta (ERR-244).
  private readonly falhas = new FalhasDoPoller(this.logger);
  private rodando = false;
  constructor(private readonly anota: AnotaAiService) {}

  @Interval(30000)
  async tick() {
    if (String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true') return;
    if (this.rodando) return;
    this.rodando = true;
    try {
      const integs = await this.anota.integracoesAtivas();
      for (const ig of integs) {
        try {
          await this.anota.sincronizar(ig.tenantId);
          this.falhas.funcionou(ig.tenantId, `poller Anota Aí tenant ${ig.tenantId}`);
        } catch (e: any) {
          this.falhas.falhou(ig.tenantId, `poller Anota Aí tenant ${ig.tenantId}`, e);
        }
      }
    } finally {
      this.rodando = false;
    }
  }
}
