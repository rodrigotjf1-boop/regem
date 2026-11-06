import { MENSAGEM_PRAZO_DO_PIX, diasDesdeOPagamento, pagoNoPixOnline, podeCancelarPagoNoPix } from './prazo-estorno-pix';

// O prazo do estorno do Pix (Regulamento do Pix: devolução até 90 dias do pagamento): a loja cancela até 89 dias; o que é
// "pago no Pix online" (o que o cancelamento estorna).
describe('prazo do estorno do Pix', () => {
  const agora = new Date('2026-11-06T12:00:00Z');
  const ha = (dias: number) => new Date(agora.getTime() - dias * 86_400_000);

  it('cancela até 89 dias do pagamento; depois, não', () => {
    expect(podeCancelarPagoNoPix(ha(0), agora)).toBe(true);
    expect(podeCancelarPagoNoPix(ha(89), agora)).toBe(true);
    expect(podeCancelarPagoNoPix(ha(89.01), agora)).toBe(false);
    expect(podeCancelarPagoNoPix(ha(120).toISOString(), agora)).toBe(false);
    expect(diasDesdeOPagamento(ha(10), agora)).toBeCloseTo(10);
  });

  it('pago no Pix online = pago + aprovado + id do pagamento + um gateway de Pix, sem sinal de encomenda', () => {
    const base = { pago: true, statusPagamento: 'aprovado', gatewayPaymentId: 'p1', gatewayProvider: 'mercadopago', sinalStatus: null };
    expect(pagoNoPixOnline(base)).toBe(true);
    expect(pagoNoPixOnline({ ...base, gatewayProvider: 'pagseguro' })).toBe(true);
    expect(pagoNoPixOnline({ ...base, gatewayProvider: 'rede' })).toBe(true);
    expect(pagoNoPixOnline({ ...base, pago: false })).toBe(false);
    expect(pagoNoPixOnline({ ...base, statusPagamento: 'na_entrega' })).toBe(false);
    expect(pagoNoPixOnline({ ...base, gatewayPaymentId: null })).toBe(false);
    expect(pagoNoPixOnline({ ...base, gatewayProvider: 'gogem' })).toBe(false);
    expect(pagoNoPixOnline({ ...base, sinalStatus: 'pago' })).toBe(false);
  });

  it('o aviso diz o prazo e o porquê', () => {
    expect(MENSAGEM_PRAZO_DO_PIX).toMatch(/há mais de 89 dias/);
    expect(MENSAGEM_PRAZO_DO_PIX).toMatch(/até 90 dias depois do pagamento \(regra do Banco Central\)/);
  });
});
