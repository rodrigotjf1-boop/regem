import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { createHash } from 'crypto';

/**
 * Frente A — coletor de telemetria no EDGE. Observa as respostas: em erro 5xx
 * (ou não tratado), posta o evento na NUVEM (`/edge/telemetria`, x-sync-token) e
 * RE-LANÇA (não muda a resposta da API). Dedup em memória (5 min) para não floodar.
 * Só age no edge (EDGE_MODE) com CLOUD_API + SYNC_TOKEN — na nuvem é passthrough.
 */
@Injectable()
export class TelemetriaInterceptor implements NestInterceptor {
  private readonly isEdge = String(process.env.EDGE_MODE ?? '').toLowerCase() === 'true';
  private readonly cloud = (process.env.CLOUD_API ?? '').replace(/\/$/, '');
  private readonly token = process.env.SYNC_TOKEN ?? '';
  private readonly enviados = new Map<string, number>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (!this.isEdge || !this.cloud || !this.token) return next.handle();
    const req = context.switchToHttp().getRequest();
    return next.handle().pipe(
      catchError((err) => {
        const status = err?.status ?? (typeof err?.getStatus === 'function' ? err.getStatus() : 500);
        if (Number(status) >= 500) this.reportar(err, req);
        return throwError(() => err);
      }),
    );
  }

  private reportar(err: any, req: any) {
    const mensagem = String(err?.message ?? err).slice(0, 500);
    const hash = createHash('sha256').update(mensagem.replace(/\d+/g, '#')).digest('hex').slice(0, 16);
    const agora = Date.now();
    if (agora - (this.enviados.get(hash) ?? 0) < 5 * 60 * 1000) return; // dedup 5 min
    this.enviados.set(hash, agora);
    fetch(`${this.cloud}/edge/telemetria`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-sync-token': this.token },
      body: JSON.stringify({
        origem: 'api',
        nivel: 'error',
        tipo: 'http_500',
        mensagem,
        stack: err?.stack ? String(err.stack).slice(0, 4000) : null,
        versao: process.env.APP_VERSION ?? null,
        contexto: { rota: req?.url, metodo: req?.method },
      }),
    }).catch(() => {});
  }
}
