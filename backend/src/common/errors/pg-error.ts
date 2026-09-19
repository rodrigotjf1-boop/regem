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
    // Dado de ENTRADA em formato inválido (id vazio, data/numero malformado, texto longo demais).
    // Reproduzido (set/2026): `entregador/pagamento/fechar` com id "" → 22P02 → 500. O filtro
    // registra estes casos como AVISO com a causa (não somem: um defeito real também cai aqui).
    case '22P02': // invalid_text_representation (ex.: uuid "")
    case '22007': // invalid_datetime_format
    case '22008': // datetime_field_overflow
    case '22003': // numeric_value_out_of_range
    case '22001': // string_data_right_truncation
      return new AppError({ code: ErrorCodes.VALIDATION_ERROR, message: 'Valor em formato inválido.', statusCode: HttpStatus.BAD_REQUEST, cause: err, isOperational: true });
    case '23514': // check_violation
      return new AppError({ code: ErrorCodes.VALIDATION_ERROR, message: 'Valor fora do permitido.', statusCode: HttpStatus.BAD_REQUEST, cause: err, isOperational: true });
    case '40001': // serialization_failure
    case '40P01': // deadlock_detected
      return new AppError({ code: ErrorCodes.DATABASE_CONFLICT, message: 'Conflito de concorrência. Tente novamente.', statusCode: HttpStatus.CONFLICT, cause: err, isOperational: true, retryable: true });
    case '57P01': // admin_shutdown
    // Postgres AINDA SUBINDO ou em recuperação ("the database system is starting up").
    // É exatamente o que acontece no boot do PC da loja: o serviço da API sobe antes do
    // Postgres terminar a recuperação e TODA rota devolvia 500 genérico por alguns segundos.
    // 503 + retryable diz ao cliente o que é: temporário, pode tentar de novo.
    case '57P03': // cannot_connect_now
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
