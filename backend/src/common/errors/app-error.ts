import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCodes } from './error-codes';
import type { ErrorCode } from './error-codes';

export interface AppErrorOptions {
  code: ErrorCode;
  message: string;
  /** HTTP a devolver (default 500). */
  statusCode?: number;
  /** Dados SEGUROS para o cliente (ex.: campos inválidos). Nunca inclua segredo/SQL. */
  details?: unknown;
  /** Erro original — vai só para telemetria/log via `cause`, NUNCA para o cliente. */
  cause?: unknown;
  /** true = erro ESPERADO de negócio; false = falha inesperada. */
  isOperational?: boolean;
  /** true = a operação pode ser repetida com segurança. */
  retryable?: boolean;
}

// Erro de aplicação com CÓDIGO estável. Estende HttpException de propósito: assim anda no
// pipeline atual do Nest e é serializado pelo filtro global (que injeta code + requestId no
// envelope), sem criar um caminho de tratamento paralelo. Distingue erro esperado
// (isOperational) de falha inesperada, e o que é seguro repetir (retryable).
export class AppError extends HttpException {
  readonly code: ErrorCode;
  readonly details?: unknown;
  readonly isOperational: boolean;
  readonly retryable: boolean;

  constructor(opts: AppErrorOptions) {
    const status = opts.statusCode ?? HttpStatus.INTERNAL_SERVER_ERROR;
    super(
      {
        statusCode: status,
        message: opts.message,
        code: opts.code,
        ...(opts.details !== undefined ? { details: opts.details } : {}),
      },
      status,
      { cause: opts.cause },
    );
    this.code = opts.code;
    this.details = opts.details;
    this.isOperational = opts.isOperational ?? true;
    this.retryable = opts.retryable ?? false;
  }

  // Fábricas de conveniência (usadas de forma incremental nos blocos seguintes).
  static conflict(code: ErrorCode, message: string, cause?: unknown): AppError {
    return new AppError({ code, message, statusCode: HttpStatus.CONFLICT, cause, isOperational: true });
  }
  static notFound(message = 'Recurso não encontrado.', code: ErrorCode = ErrorCodes.RESOURCE_NOT_FOUND): AppError {
    return new AppError({ code, message, statusCode: HttpStatus.NOT_FOUND, isOperational: true });
  }
  static validation(message: string, details?: unknown): AppError {
    return new AppError({ code: ErrorCodes.VALIDATION_ERROR, message, statusCode: HttpStatus.BAD_REQUEST, details, isOperational: true });
  }
  static externalTimeout(message = 'O serviço externo demorou a responder.'): AppError {
    return new AppError({ code: ErrorCodes.EXTERNAL_SERVICE_TIMEOUT, message, statusCode: HttpStatus.GATEWAY_TIMEOUT, isOperational: true, retryable: true });
  }
  static external(message = 'Falha ao falar com o serviço externo.', cause?: unknown): AppError {
    return new AppError({ code: ErrorCodes.EXTERNAL_SERVICE_ERROR, message, statusCode: HttpStatus.BAD_GATEWAY, cause, isOperational: true });
  }
}
