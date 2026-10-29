import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ErroProblema } from '../../dms/integracao-dms';
import { anotarChamada } from './chamada-integracao';
import { urlParaLog } from '../../common/url-para-log';

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
  | 'conta-bloqueada'
  | 'limite-de-chamadas'
  | 'parametro-invalido'
  | 'cursor-invalido'
  | 'nao-encontrado'
  | 'codigo-em-uso'
  | 'chave-em-uso'
  | 'regra-invalida'
  | 'chave-reutilizada'
  // Troca do código da autorização pela loja (C1b).
  | 'cliente-invalido'
  | 'autorizacao-invalida'
  // Avisos (webhooks, mig 304).
  | 'endereco-nao-permitido'
  | 'aviso-indisponivel'
  // Via do DMS ID (Hub DMS, F3, mig 329): o segredo da ligação ausente, inexistente ou revogado.
  | 'ligacao-invalida'
  // A ligação de um aplicativo de parceiro parada há 90 dias (Padrão §3; F4, parte F): 403, volta com um clique novo.
  | 'ligacao-suspensa'
  // A parada (Hub DMS, F3 A2): a lista do hub ou a chave própria `ACEITAR_INTEGRACOES` — 503 com `Retry-After`.
  | 'integracao-parada'
  | 'erro-interno';

const TITULO: Record<TipoProblema, string> = {
  'token-invalido': 'Token inválido',
  'escopo-insuficiente': 'Escopo insuficiente',
  'conta-bloqueada': 'Conta bloqueada',
  'limite-de-chamadas': 'Limite de chamadas',
  'parametro-invalido': 'Parâmetro inválido',
  'cursor-invalido': 'Cursor inválido',
  'nao-encontrado': 'Não encontrado',
  'codigo-em-uso': 'Código em uso',
  'chave-em-uso': 'Chave de idempotência em uso',
  'regra-invalida': 'Regra inválida',
  'chave-reutilizada': 'Chave de idempotência reutilizada',
  'cliente-invalido': 'Cliente inválido',
  'autorizacao-invalida': 'Autorização inválida',
  'endereco-nao-permitido': 'Endereço não permitido',
  'aviso-indisponivel': 'Avisos indisponíveis',
  'ligacao-invalida': 'Ligação inválida',
  'ligacao-suspensa': 'Ligação suspensa',
  'integracao-parada': 'Integração parada',
  'erro-interno': 'Erro interno',
};

/** Corpo `problem+json` sem o `request_id` — o que a idempotência guarda e devolve no reenvio. */
export function corpoProblema(status: number, tipo: TipoProblema, detalhe: string) {
  return { type: BASE_TIPO_PROBLEMA + tipo, title: TITULO[tipo], status, detail: detalhe };
}

/** A exceção de um corpo guardado por `corpoProblema` (reenvio de uma resposta de erro). */
export function problemaGuardado(corpo: any, statusGuardado: number): ProblemaException {
  const tipo = String(corpo?.type ?? '').slice(BASE_TIPO_PROBLEMA.length) as TipoProblema;
  const conhecido = Object.prototype.hasOwnProperty.call(TITULO, tipo);
  return new ProblemaException(statusGuardado, conhecido ? tipo : tipoPeloStatus(statusGuardado), String(corpo?.detail ?? ''));
}

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

/** O nome do problema do pacote comum (`ErroProblema`, Hub DMS) que o Regem conhece; o resto, pelo status. */
function tipoDoPacote(e: ErroProblema): TipoProblema {
  return Object.prototype.hasOwnProperty.call(TITULO, e.tipo) ? (e.tipo as TipoProblema) : tipoPeloStatus(e.status);
}

/** O corpo `problem+json` de uma exceção (exportado para o teste). */
export function problemaDe(exception: unknown, requestId?: string | null) {
  const doPacote = exception instanceof ErroProblema ? exception : null;
  const status = exception instanceof HttpException ? exception.getStatus() : doPacote ? doPacote.status : HttpStatus.INTERNAL_SERVER_ERROR;
  const tipo = exception instanceof ProblemaException ? exception.tipo : doPacote ? tipoDoPacote(doPacote) : tipoPeloStatus(status);
  let detalhe = 'Erro interno. Tente de novo em instantes.';
  // A parada (503) é recusa esperada, com a frase do pacote — não é erro a mascarar.
  const esperado = status < 500 || tipo === 'integracao-parada';
  if (esperado && exception instanceof HttpException) {
    const raw: any = exception.getResponse();
    const msg = typeof raw === 'string' ? raw : raw?.message;
    detalhe = Array.isArray(msg) ? msg.join('; ') : String(msg ?? TITULO[tipo]);
  } else if (esperado && doPacote) {
    detalhe = doPacote.detalhe;
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
    const tipo = corpo.type.slice(BASE_TIPO_PROBLEMA.length);
    // O registro do hub (Hub DMS, F3 A2): o problema de toda recusa e, no erro inesperado, o motivo. A limpeza (credencial
    // do Regem e dado pessoal) é na porta de saída para o hub (`HubDmsService.erro`), um lugar só.
    anotarChamada({ problema: tipo });
    if (status >= 500 && tipo !== 'integracao-parada') {
      const err = exception as any;
      log.error(
        `${req?.method ?? '?'} ${urlParaLog(req?.originalUrl ?? req?.url) || '?'} → ${status}` +
          `${requestId ? ` [${requestId}]` : ''}: ${err?.code ? `[${err.code}] ` : ''}${err?.message ?? err}`,
        err?.stack,
      );
      anotarChamada({
        erro: {
          tipo: err instanceof Error ? err.name : `HTTP ${status}`,
          mensagem: String(err?.message ?? err),
        },
      });
    }
    if (res?.headersSent) return;
    const retryAfterSeg =
      exception instanceof ProblemaException || exception instanceof ErroProblema ? exception.retryAfterSeg : undefined;
    if (retryAfterSeg) res.setHeader('Retry-After', String(retryAfterSeg));
    res.status(status).type('application/problem+json').send(JSON.stringify(corpo));
  }
}
