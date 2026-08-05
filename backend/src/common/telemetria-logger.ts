import { ConsoleLogger } from '@nestjs/common';
import { createHash } from 'crypto';
import { TelemetriaBridge } from './telemetria-bridge';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Logger do app que, além de logar no console, leva os erros (error/fatal) para a
// telemetria da distribuição. Captura QUALQUER `logger.error`/`logger.fatal` do
// sistema — services, pollers, jobs e erros não tratados — não só o HTTP 5xx (que o
// filtro/interceptor cobrem). No EDGE envia por HTTP para a nuvem; na NUVEM grava
// direto no store (TelemetriaBridge, sem HTTP pra si mesma). Dedup em memória (5 min).
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
    // `super` não pode ser usado como expressão; loga via error (diferença é só
    // cosmética no console). A telemetria ainda marca nivel='fatal'.
    super.error(message, stack, context);
    this.enviar('fatal', message, stack, context);
  }

  private enviar(nivel: 'error' | 'fatal', message: any, stack?: string, context?: string) {
    const ctx = context ?? '';
    if (ctx === 'TelemetriaLogger') return;
    const msg = String(message ?? '').slice(0, 800);
    // Não reprocessa a própria telemetria (registrarTelemetria loga "[telemetria] …",
    // que voltaria pra cá e faria loop na nuvem).
    if (msg.startsWith('[telemetria]')) return;

    // Dedup em memória (5 min) por hash — vale p/ edge (HTTP) e nuvem (write no banco).
    const norm = msg
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<id>')
      .replace(/\d+/g, '#');
    const hash = createHash('sha256').update(`${ctx}|${norm}`).digest('hex').slice(0, 16);
    const agora = Date.now();
    if (agora - (TelemetriaLogger.enviados.get(hash) ?? 0) < 5 * 60 * 1000) return;
    TelemetriaLogger.enviados.set(hash, agora);

    const tipo = ctx ? `log:${ctx}`.slice(0, 60) : 'log';
    const stackCurto = stack ? String(stack).slice(0, 4000) : null;

    // Nuvem: grava direto no store da telemetria (sem tenant = erro global da nuvem).
    if (!TelemetriaLogger.ehEdge) {
      TelemetriaBridge.reportar(null, {
        origem: 'backend',
        nivel,
        tipo,
        mensagem: msg,
        stack: stackCurto,
        versao: process.env.APP_VERSION ?? null,
        contexto: { context: ctx },
      });
      return;
    }

    // Edge: envia por HTTP para a nuvem (a tabela vive na nuvem).
    const cloud = (process.env.CLOUD_API ?? '').replace(/\/$/, '');
    const token = process.env.SYNC_TOKEN ?? '';
    if (!cloud || !token) return;
    fetch(`${cloud}/edge/telemetria`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': token },
      body: JSON.stringify({
        origem: 'backend',
        nivel,
        tipo,
        mensagem: msg,
        stack: stackCurto,
        versao: process.env.APP_VERSION ?? null,
        contexto: { context: ctx },
      }),
    }).catch(() => {});
  }
}
