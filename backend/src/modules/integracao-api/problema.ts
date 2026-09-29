import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERROS DA API DE INTEGRAÇÃO no formato RFC 9457 (`application/problem+json`), como o contrato
// pede: `type`, `title`, `status`, `detail` e o `request_id` para correlacionar. O filtro global
// (`telemetria-exception.filter`) devolve outro envelope — este vale só para o controller de
// integração, e também pega o que os guards globais lançam antes (429 por IP, 404 do CloudOnly).
// Mantém o log local de todo 5xx com a causa real (V11) e mascara a mensagem na resposta.

export const BASE_TIPO_PROBLEMA = 'https://api.dmsregem.com/problemas/';

export type TipoProblema =
  | 'token-invalido'
  | 'escopo-insuficiente'
  | 'limite-de-chamadas'
  | 'parametro-invalido'
  | 'cursor-invalido'
  | 'nao-encontrado'
  | 'codigo-em-uso'
  | 'chave-em-uso'
  | 'regra-invalida'
  | 'chave-reutilizada'
  | 'erro-interno';

const TITULO: Record<TipoProblema, string> = {
  'token-invalido': 'Token inválido',
  'escopo-insuficiente': 'Escopo insuficiente',
  'limite-de-chamadas': 'Limite de chamadas',
  'parametro-invalido': 'Parâmetro inválido',
  'cursor-invalido': 'Cursor inválido',
  'nao-encontrado': 'Não encontrado',
  'codigo-em-uso': 'Código em uso',
  'chave-em-uso': 'Chave de idempotência em uso',
  'regra-invalida': 'Regra inválida',
  'chave-reutilizada': 'Chave de idempotência reutilizada',
  'erro-interno': 'Erro interno',
};

/** Erro com o `type` do contrato (e, no 429, o `Retry-After`). */
export class ProblemaException extends HttpException {
  constructor(
    status: number,
    readonly tipo: TipoProblema,
    detalhe: string,
    readonly retryAfterSeg?: number,
  ) {
    super(detalhe, status);
  }
}

function tipoPeloStatus(status: number): TipoProblema {
  switch (status) {
    case 400:
      return 'parametro-invalido';
    case 401:
      return 'token-invalido';
    case 403:
      return 'escopo-insuficiente';
    case 404:
      return 'nao-encontrado';
    case 422:
      return 'regra-invalida';
    case 429:
      return 'limite-de-chamadas';
    default:
      return status >= 500 ? 'erro-interno' : 'parametro-invalido';
  }
}

const log = new Logger('Integracao 5xx');

/** O corpo `problem+json` de uma exceção (exportado para o teste). */
export function problemaDe(exception: unknown, requestId?: string | null) {
  const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  const tipo = exception instanceof ProblemaException ? exception.tipo : tipoPeloStatus(status);
  let detalhe = 'Erro interno. Tente de novo em instantes.';
  if (status < 500 && exception instanceof HttpException) {
    const raw: any = exception.getResponse();
    const msg = typeof raw === 'string' ? raw : raw?.message;
    detalhe = Array.isArray(msg) ? msg.join('; ') : String(msg ?? TITULO[tipo]);
  }
  return {
    status,
    corpo: {
      type: BASE_TIPO_PROBLEMA + tipo,
      title: TITULO[tipo],
      status,
      detail: detalhe,
      ...(requestId ? { request_id: requestId } : {}),
    },
  };
}

@Catch()
export class ProblemaFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req: any = http.getRequest();
    const res: any = http.getResponse();
    const requestId: string | undefined = req?.requestId;
    const { status, corpo } = problemaDe(exception, requestId);
    if (status >= 500) {
      const err = exception as any;
      log.error(
        `${req?.method ?? '?'} ${req?.originalUrl ?? req?.url ?? '?'} → ${status}` +
          `${requestId ? ` [${requestId}]` : ''}: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`,
        err?.stack,
      );
    }
    if (res?.headersSent) return;
    if (exception instanceof ProblemaException && exception.retryAfterSeg) {
      res.setHeader('Retry-After', String(exception.retryAfterSeg));
    }
    res.status(status).type('application/problem+json').send(JSON.stringify(corpo));
  }
}
