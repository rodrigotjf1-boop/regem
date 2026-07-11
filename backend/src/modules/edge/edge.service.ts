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

  // Compara "1.4.2" > "1.4.0" numericamente por segmento (não string).
  private static maior(a: string, b: string): boolean {
    const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
    const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const x = pa[i] ?? 0;
      const y = pb[i] ?? 0;
      if (x !== y) return x > y;
    }
    return false;
  }

  // O edge pergunta "tem versão nova?". A nuvem responde com a última publicada
  // (env EDGE_LATEST_VERSION) + url do pacote assinado + notas. Sem segredo → público.
  // A aplicação em si (baixar/trocar/reiniciar) é feita pelo daemon/instalador no PC.
  atualizacao(versaoCliente?: string) {
    const ultima = process.env.EDGE_LATEST_VERSION ?? process.env.APP_VERSION ?? '1';
    const atual = versaoCliente || '0';
    return {
      atual,
      ultima,
      atualizar: EdgeService.maior(ultima, atual),
      url: process.env.EDGE_UPDATE_URL ?? null,
      sha256: process.env.EDGE_UPDATE_SHA256 ?? null,
      notas: process.env.EDGE_UPDATE_NOTAS ?? null,
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
