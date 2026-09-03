import { AppError } from './app-error';
import { ErrorCodes } from './error-codes';
import { mapPgError, pgRetryable } from './pg-error';
import { TelemetriaExceptionFilter } from '../telemetria-exception.filter';
import { NotFoundException } from '@nestjs/common';

// Backbone de erros (Bloco 1): mapeamento pg → AppError, flags do AppError e o ENVELOPE
// aditivo do filtro (statusCode/message/error preservados + code + requestId). Sem DB/HTTP.

describe('mapPgError', () => {
  it('23505 (unique) → 409 DATABASE_CONFLICT, mensagem segura (sem SQL)', () => {
    const e = mapPgError({ code: '23505', message: 'duplicate key value violates unique constraint "x_pkey"' })!;
    expect(e).toBeInstanceOf(AppError);
    expect(e.getStatus()).toBe(409);
    expect(e.code).toBe(ErrorCodes.DATABASE_CONFLICT);
    expect(e.message).toBe('Registro já existe.'); // não vaza o texto do pg
  });

  it('23502 (not null) → 400 VALIDATION_ERROR', () => {
    const e = mapPgError({ code: '23502' })!;
    expect(e.getStatus()).toBe(400);
    expect(e.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('40001/40P01 → conflito RETRYABLE', () => {
    expect(mapPgError({ code: '40001' })!.retryable).toBe(true);
    expect(mapPgError({ code: '40P01' })!.retryable).toBe(true);
  });

  it('conexão (08006/57P01) → 503 DATABASE_UNAVAILABLE retryable', () => {
    const e = mapPgError({ code: '08006' })!;
    expect(e.getStatus()).toBe(503);
    expect(e.code).toBe(ErrorCodes.DATABASE_UNAVAILABLE);
    expect(e.retryable).toBe(true);
  });

  it('código desconhecido e erro não-pg → null (vira 500 mascarado no filtro)', () => {
    expect(mapPgError({ code: '99999' })).toBeNull();
    expect(mapPgError(new Error('qualquer'))).toBeNull();
    expect(mapPgError(null)).toBeNull();
  });
});

describe('pgRetryable', () => {
  it('só serialization/deadlock são seguros de repetir', () => {
    expect(pgRetryable({ code: '40001' })).toBe(true);
    expect(pgRetryable({ code: '40P01' })).toBe(true);
    expect(pgRetryable({ code: '23505' })).toBe(false);
    expect(pgRetryable(new Error('x'))).toBe(false);
  });
});

describe('AppError', () => {
  it('carrega code/status/flags e embute o code na resposta', () => {
    const e = new AppError({ code: ErrorCodes.AUTH_PIN_INVALID, message: 'PIN inválido', statusCode: 401 });
    expect(e.getStatus()).toBe(401);
    expect(e.code).toBe(ErrorCodes.AUTH_PIN_INVALID);
    expect(e.isOperational).toBe(true);
    expect((e.getResponse() as any).code).toBe(ErrorCodes.AUTH_PIN_INVALID);
  });
});

describe('TelemetriaExceptionFilter — envelope aditivo', () => {
  function fakeRes() {
    const captured: any = { status: undefined, body: undefined };
    return {
      headersSent: false,
      status(c: number) { captured.status = c; return this; },
      json(b: any) { captured.body = b; return this; },
      setHeader() {},
      _c: captured,
    };
  }
  function host(req: any, res: any): any {
    return { getType: () => 'http', switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) };
  }
  const filtro = new TelemetriaExceptionFilter();
  const req = { requestId: 'rid-1', url: '/x', method: 'GET' };

  it('HttpException: preserva statusCode/message/error e ACRESCENTA code + requestId', () => {
    const res = fakeRes();
    filtro.catch(new NotFoundException('Nada aqui'), host(req, res));
    expect(res._c.status).toBe(404);
    expect(res._c.body).toMatchObject({
      statusCode: 404,
      message: 'Nada aqui',
      error: 'Not Found',
      code: ErrorCodes.RESOURCE_NOT_FOUND,
      requestId: 'rid-1',
    });
  });

  it('erro CRU do pg é normalizado (23505 → 409, sem vazar SQL)', () => {
    const res = fakeRes();
    filtro.catch({ code: '23505', message: 'duplicate key ... constraint "x"' }, host(req, res));
    expect(res._c.status).toBe(409);
    expect(res._c.body.code).toBe(ErrorCodes.DATABASE_CONFLICT);
    expect(res._c.body.message).toBe('Registro já existe.');
    expect(JSON.stringify(res._c.body)).not.toContain('constraint');
  });

  it('erro inesperado → 500 MASCARADO (sem message/stack real) + INTERNAL_ERROR', () => {
    const res = fakeRes();
    filtro.catch(new Error('detalhe interno secreto'), host(req, res));
    expect(res._c.status).toBe(500);
    expect(res._c.body.message).toBe('Ocorreu um erro interno.');
    expect(res._c.body.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(JSON.stringify(res._c.body)).not.toContain('secreto');
  });
});
