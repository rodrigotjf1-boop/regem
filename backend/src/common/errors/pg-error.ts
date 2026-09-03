import { HttpStatus } from '@nestjs/common';
import { AppError } from './app-error';
import { ErrorCodes } from './error-codes';

// Mapeia erros do driver `pg` / PostgreSQL para AppError com mensagem SEGURA — sem SQL, sem
// nome de constraint, sem detalhe interno (o erro cru vai só para telemetria via `cause`).
// Retorna null quando não reconhece o código → o filtro deixa virar 500 mascarado.
export function mapPgError(err: unknown): AppError | null {
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return null;
  switch (code) {
    case '23505': // unique_violation
      return new AppError({ code: ErrorCodes.DATABASE_CONFLICT, message: 'Registro já existe.', statusCode: HttpStatus.CONFLICT, cause: err, isOperational: true });
    case '23503': // foreign_key_violation
      return new AppError({ code: ErrorCodes.DATABASE_CONFLICT, message: 'Referência inválida ou registro em uso.', statusCode: HttpStatus.CONFLICT, cause: err, isOperational: true });
    case '23502': // not_null_violation
      return new AppError({ code: ErrorCodes.VALIDATION_ERROR, message: 'Campo obrigatório ausente.', statusCode: HttpStatus.BAD_REQUEST, cause: err, isOperational: true });
    case '23514': // check_violation
      return new AppError({ code: ErrorCodes.VALIDATION_ERROR, message: 'Valor fora do permitido.', statusCode: HttpStatus.BAD_REQUEST, cause: err, isOperational: true });
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new AppError({ code: ErrorCodes.DATABASE_CONFLICT, message: 'Conflito de concorrência. Tente novamente.', statusCode: HttpStatus.CONFLICT, cause: err, isOperational: true, retryable: true });
    case '57P01': // admin_shutdown
    case '08006': // connection_failure
    case '08003': // connection_does_not_exist
    case '08001': // sqlclient_unable_to_establish_sqlconnection
    case 'ECONNREFUSED':
    case 'ETIMEDOUT':
      return new AppError({ code: ErrorCodes.DATABASE_UNAVAILABLE, message: 'Banco de dados temporariamente indisponível.', statusCode: HttpStatus.SERVICE_UNAVAILABLE, cause: err, isOperational: false, retryable: true });
    default:
      return null;
  }
}

// A falha do pg é transitória e SEGURA de repetir (serialization/deadlock)? Base do retry
// idempotente nos blocos seguintes — nunca repetir cegamente operação não idempotente.
export function pgRetryable(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === '40001' || code === '40P01';
}
