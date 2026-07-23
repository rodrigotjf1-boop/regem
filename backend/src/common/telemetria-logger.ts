import { ConsoleLogger } from '@nestjs/common';
import { createHash } from 'crypto';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Logger do app que, além de logar no console, ENVIA os erros para a telemetria da
// nuvem quando roda no EDGE (EDGE_MODE + CLOUD_API + SYNC_TOKEN). Captura QUALQUER
// `logger.error`/`logger.fatal` do sistema — services, pollers, jobs e erros não
// tratados — não só o HTTP 5xx (que o TelemetriaInterceptor já cobre). Assim a
// distribuição enxerga também as falhas de background (ex.: poller de integração
// caindo), que antes ficavam só no log local. Dedup em memória (5 min) por hash.
export class TelemetriaLogger extends ConsoleLogger {
  private static enviados = new Map<string, number>();
  private static get ehEdge(): boolean {
    return String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  }

  error(message: any, stack?: string, context?: string) {
    super.error(message, stack, context);
    this.enviar('error', message, stack, context);
  }

  fatal(message: any, stack?: string, context?: string) {
    // `super` não pode ser usado como expressão ((super as any) é erro de sintaxe).
    // Loga sempre via error (diferença é só cosmética no console); a telemetria
    // ainda marca nivel='fatal'.
    super.error(message, stack, context);
    this.enviar('fatal', message, stack, context);
  }

  private enviar(nivel: 'error' | 'fatal', message: any, stack?: string, context?: string) {
    const cloud = (process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!TelemetriaLogger.ehEdge || !cloud || !token) return;
    // Não reenvia a própria telemetria (evita loop se o POST de telemetria logar erro).
    const ctx = context ?? '';
    if (ctx === 'TelemetriaLogger') return;
    const msg = String(message ?? '').slice(0, 800);
    const norm = msg.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>').replace(/\d+/g, '#');
    const hash = createHash('sha256').update(`${ctx}|${norm}`).digest('hex').slice(0, 16);
    const agora = Date.now();
    if (agora - (TelemetriaLogger.enviados.get(hash) ?? 0) < 5 * 60 * 1000) return; // dedup 5 min
    TelemetriaLogger.enviados.set(hash, agora);
    fetch(`${cloud}/edge/telemetria`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({
        origem: 'backend',
        nivel,
        tipo: ctx ? `log:${ctx}`.slice(0, 60) : 'log',
        mensagem: msg,
        stack: stack ? String(stack).slice(0, 4000) : null,
        versao: process.env.APP_VERSION ?? null,
        contexto: { context: ctx },
      }),
    }).catch(() => {});
  }
}
