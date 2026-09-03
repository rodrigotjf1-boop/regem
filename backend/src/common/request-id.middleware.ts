import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { requestContext } from './request-context';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Aceita X-Request-ID de entrada (propagação frontend → API → integração/sync) ou gera um.
// Ecoa no header de resposta e guarda no ALS para o logger/filtro correlacionarem. NÃO
// derruba nada — só carimba o request. Roda antes de guards/interceptors (é middleware).
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: any, res: any, next: () => void) {
    const raw = req?.headers?.['x-request-id'];
    const incoming = Array.isArray(raw) ? raw[0] : raw;
    const requestId =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= 128
        ? incoming
        : randomUUID();
    req.requestId = requestId;
    try {
      res.setHeader('X-Request-ID', requestId);
    } catch {
      /* header já enviado — ignora */
    }
    requestContext.run({ requestId }, () => next());
  }
}
