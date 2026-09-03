import { classificarFalhaGateway, GatewayError } from './gateway-erro';

// R2 — a decisão do fallback de pagamento depende desta classificação: ambíguo = a cobrança PODE
// ter sido criada (NÃO recriar em outro gateway → evita 2ª PIX); definitivo = nada criado (seguro
// cair no próximo). Erro de estado desconhecido é sempre tratado como ambíguo (lado seguro).
describe('classificarFalhaGateway (R2 — fallback seguro)', () => {
  it('sem status (rede/timeout/abort) → ambíguo', () => {
    const e = classificarFalhaGateway(new Error('fetch failed'));
    expect(e).toBeInstanceOf(GatewayError);
    expect(e.ambiguo).toBe(true);
    expect(e.status).toBeUndefined();
  });

  it('5xx / 408 / 429 → ambíguo (não recriar em outro gateway)', () => {
    expect(classificarFalhaGateway(new Error('x'), 500).ambiguo).toBe(true);
    expect(classificarFalhaGateway(new Error('x'), 502).ambiguo).toBe(true);
    expect(classificarFalhaGateway(new Error('x'), 408).ambiguo).toBe(true);
    expect(classificarFalhaGateway(new Error('x'), 429).ambiguo).toBe(true);
  });

  it('4xx do provedor (400/401/403/422) → DEFINITIVO (seguro cair no próximo gateway)', () => {
    expect(classificarFalhaGateway(new Error('x'), 400).ambiguo).toBe(false);
    expect(classificarFalhaGateway(new Error('x'), 401).ambiguo).toBe(false);
    expect(classificarFalhaGateway(new Error('x'), 403).ambiguo).toBe(false);
    expect(classificarFalhaGateway(new Error('x'), 422).ambiguo).toBe(false);
  });

  it('estende Error → o catch genérico existente continua valendo', () => {
    const e = classificarFalhaGateway(new Error('boom'), 400);
    expect(e instanceof Error).toBe(true);
    expect(e.message).toBe('boom');
  });
});
