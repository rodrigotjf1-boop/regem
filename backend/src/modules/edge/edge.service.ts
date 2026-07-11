import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { Bonjour } from 'bonjour-service';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Descoberta do servidor local na LAN. SÓ roda no edge (EDGE_MODE=true) — a
// nuvem não anuncia mDNS. Publica `_regem._tcp` + hostname `regem.local` para
// os clientes (KDS/PDV/Ponto) acharem o servidor sem configurar IP.
@Injectable()
export class EdgeService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Edge');
  private bonjour?: InstanceType<typeof Bonjour>;

  static get ehEdge(): boolean {
    return String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  }

  info() {
    return {
      regem: true,
      edge: EdgeService.ehEdge,
      versao: process.env.APP_VERSION ?? '1',
      unidadeId: process.env.EDGE_UNIDADE_ID ?? null,
      ts: new Date().toISOString(),
    };
  }

  onApplicationBootstrap() {
    if (!EdgeService.ehEdge) return; // nuvem não anuncia
    try {
      const porta = Number(process.env.PORT) || 3001;
      this.bonjour = new Bonjour();
      this.bonjour.publish({
        name: 'Regem Edge',
        type: 'regem',
        port: porta,
        host: 'regem.local',
        txt: { versao: process.env.APP_VERSION ?? '1', unidade: process.env.EDGE_UNIDADE_ID ?? '' },
      });
      this.logger.log(`mDNS publicado: _regem._tcp em regem.local:${porta}`);
    } catch (e: any) {
      this.logger.warn(`mDNS não pôde publicar: ${e?.message ?? e}`);
    }
  }

  onModuleDestroy() {
    try {
      this.bonjour?.unpublishAll();
      this.bonjour?.destroy();
    } catch {
      /* ignore */
    }
  }
}
