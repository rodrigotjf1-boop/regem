import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { TelemetriaBridge } from './telemetria-bridge';

/* Filtro global de exceção. Mantém o comportamento padrão do Nest (via super.catch —
   a RESPOSTA ao cliente não muda) e, além disso, reporta à telemetria da distribuição
   as falhas de SERVIDOR (5xx) e as exceções NÃO tratadas. 4xx de rotina
   (validação/401/403/404) NÃO entram — evitam afogar o console. Só age quando o sink
   da nuvem está armado (TelemetriaBridge). */
@Catch()
export class TelemetriaExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    try {
      if (host.getType() === 'http' && TelemetriaBridge.ativo) {
        const status =
          exception instanceof HttpException ? exception.getStatus() : 500;
        if (status >= 500) {
          const req: any = host.switchToHttp().getRequest();
          const err = exception as any;
          TelemetriaBridge.reportar(req?.user?.tenantId ?? null, {
            origem: 'api',
            nivel: 'error',
            tipo: `http_${status}`,
            mensagem: String(err?.message ?? err),
            stack: err?.stack ? String(err.stack) : null,
            versao: process.env.APP_VERSION ?? null,
            contexto: { rota: req?.url, metodo: req?.method },
          });
        }
      }
    } catch {
      /* telemetria nunca interfere na resposta ao cliente */
    }
    super.catch(exception, host);
  }
}
