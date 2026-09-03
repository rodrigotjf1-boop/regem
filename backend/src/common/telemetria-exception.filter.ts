import { ArgumentsHost, Catch, HttpException, HttpStatus } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { TelemetriaBridge } from './telemetria-bridge';
import { AppError } from './errors/app-error';
import { ErrorCodes } from './errors/error-codes';
import type { ErrorCode } from './errors/error-codes';
import { mapPgError } from './errors/pg-error';

/* eslint-disable @typescript-eslint/no-explicit-any */
/* Filtro global de exceção. Padroniza o ENVELOPE de erro do cliente de forma ADITIVA —
   mantém statusCode/message/error (contrato atual que o front lê) e ACRESCENTA `code`
   (para o front reagir por código) e `requestId` (correlação). Além disso:
   - normaliza erros CRUS do pg → AppError (23505→409 etc.) sem vazar SQL;
   - mascara falhas inesperadas (5xx) — nunca devolve stack/SQL/mensagem interna;
   - reporta à telemetria da distribuição as 5xx / não tratadas (comportamento preservado). */
@Catch()
export class TelemetriaExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    // Fora de HTTP (WS/microservices) mantém o padrão do Nest.
    if (host.getType() !== 'http') {
      super.catch(exception, host);
      return;
    }
    const http = host.switchToHttp();
    const req: any = http.getRequest();
    const res: any = http.getResponse();
    const requestId: string | undefined = req?.requestId;

    // 1) Normaliza erro CRU do pg → AppError (central, sem vazar SQL/constraint).
    let ex: unknown = exception;
    if (!(ex instanceof HttpException)) {
      const mapped = mapPgError(ex);
      if (mapped) ex = mapped;
    }
    const status = ex instanceof HttpException ? ex.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

    // 2) Telemetria — só 5xx / não tratadas, quando o sink da nuvem está armado. Reporta o
    //    erro ORIGINAL (stack real). Nunca interfere na resposta.
    try {
      if (TelemetriaBridge.ativo && status >= 500) {
        const err = exception as any;
        TelemetriaBridge.reportar(req?.user?.tenantId ?? null, {
          origem: 'api',
          nivel: 'error',
          tipo: `http_${status}`,
          mensagem: String(err?.message ?? err),
          stack: err?.stack ? String(err.stack) : null,
          versao: process.env.APP_VERSION ?? null,
          contexto: { rota: req?.url, metodo: req?.method, requestId: requestId ?? null },
        });
      }
    } catch {
      /* telemetria nunca interfere na resposta ao cliente */
    }

    // 3) Envelope aditivo (statusCode/message/error preservados + code + requestId).
    try {
      let body: any;
      if (ex instanceof HttpException) {
        const raw = ex.getResponse();
        body = typeof raw === 'string' ? { statusCode: status, message: raw } : { ...(raw as any) };
      } else {
        // Inesperado → 500 MASCARADO (nunca vaza mensagem/stack/SQL).
        body = { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: 'Ocorreu um erro interno.' };
      }
      if (body.statusCode == null) body.statusCode = status;
      if (body.error == null) body.error = reasonPhrase(status);
      if (body.code == null) body.code = ex instanceof AppError ? ex.code : deriveCode(status, body.message);
      if (requestId && body.requestId == null) body.requestId = requestId;

      if (res?.headersSent) return;
      res.status(status).json(body);
    } catch {
      // Qualquer imprevisto na montagem → cai no comportamento padrão do Nest.
      if (!res?.headersSent) super.catch(exception, host);
    }
  }
}

// "Not Found", "Bad Request", "Internal Server Error"… (mesmo texto que o Nest usa em `error`).
function reasonPhrase(status: number): string {
  const key = (HttpStatus as any)[status];
  if (!key) return 'Error';
  return String(key)
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// `code` padrão para HttpExceptions legadas (sem AppError). Códigos precisos vêm do AppError
// no ponto de lançamento, de forma incremental — este é só o balde seguro por status.
function deriveCode(status: number, message: unknown): ErrorCode {
  switch (status) {
    case 400:
      return Array.isArray(message) ? ErrorCodes.VALIDATION_ERROR : ErrorCodes.BAD_REQUEST;
    case 401:
      return ErrorCodes.AUTH_UNAUTHENTICATED;
    case 403:
      return ErrorCodes.ACCESS_DENIED;
    case 404:
      return ErrorCodes.RESOURCE_NOT_FOUND;
    case 409:
      return ErrorCodes.DATABASE_CONFLICT;
    case 422:
      return ErrorCodes.VALIDATION_ERROR;
    case 429:
      return ErrorCodes.RATE_LIMITED;
    default:
      return status >= 500 ? ErrorCodes.INTERNAL_ERROR : ErrorCodes.BAD_REQUEST;
  }
}
