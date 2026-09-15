import { calcularCobranca } from './cobranca';

// Este é o cálculo que decide quanto o entregador PEDE na porta do cliente. Errar para
// mais = cobrar duas vezes de quem já pagou. Os testes cobrem os payloads reais dos
// 5 canais (mig 241) e a base legada, sem detalhe de pagamento.
describe('calcularCobranca — a receber do entregador', () => {
  it('pedido em dinheiro, base legada (sem detalhe): cobra o total', () => {
    const c = calcularCobranca({ total: 48.9, pago: false });
    expect(c.aReceber).toBe(48.9);
    expect(c.prepago).toBe(false);
    expect(c.cobrancaDetalhada).toBe(false);
    expect(c.jaPagoOnline).toBe(0);
  });

  it('pedido quitado (pago=true) não cobra nada, mesmo com total alto', () => {
    const c = calcularCobranca({ total: 120, pago: true });
    expect(c.aReceber).toBe(0);
    expect(c.prepago).toBe(true);
    expect(c.jaPagoOnline).toBe(120);
  });

  it('BUG CORRIGIDO: marketplace pré-pago com pago=false não cobra o cliente de novo', () => {
    // Era o caso caro: `pago` não chegou true, mas o pagamento é ONLINE.
    const c = calcularCobranca({
      total: 80,
      valorPagoCliente: 80,
      pago: false,
      pagamentos: [{ rotulo: 'Pago online', valor: 80, prepago: true }],
    });
    expect(c.aReceber).toBe(0);
    expect(c.prepago).toBe(true);
    expect(c.jaPagoOnline).toBe(80);
  });

  it('pagamento DIVIDIDO: cobra só a parte que não foi pré-paga', () => {
    const c = calcularCobranca({
      total: 100,
      valorPagoCliente: 100,
      pago: false,
      pagamentos: [
        { rotulo: 'PIX', valor: 60, prepago: true },
        { rotulo: 'Dinheiro', valor: 40, prepago: false },
      ],
    });
    expect(c.aReceber).toBe(40);
    expect(c.jaPagoOnline).toBe(60);
    expect(c.formasNaEntrega).toEqual([{ rotulo: 'Dinheiro', valor: 40 }]);
  });

  it('duas formas na entrega somam (dinheiro + maquininha)', () => {
    const c = calcularCobranca({
      total: 75,
      pago: false,
      pagamentos: [
        { rotulo: 'Dinheiro', valor: 25, prepago: false },
        { rotulo: 'Crédito', valor: 50, prepago: false },
      ],
    });
    expect(c.aReceber).toBe(75);
    expect(c.formasNaEntrega).toHaveLength(2);
  });

  it('troco: calcula o que levar a partir da nota informada', () => {
    const c = calcularCobranca({ total: 37.5, pago: false, trocoPara: 50 });
    expect(c.aReceber).toBe(37.5);
    expect(c.trocoPara).toBe(50);
    expect(c.troco).toBe(12.5);
  });

  it('troco com pagamento dividido usa o valor REALMENTE cobrado', () => {
    const c = calcularCobranca({
      total: 100,
      pago: false,
      trocoPara: 50,
      pagamentos: [
        { rotulo: 'Pago online', valor: 60, prepago: true },
        { rotulo: 'Dinheiro', valor: 40, prepago: false },
      ],
    });
    expect(c.aReceber).toBe(40);
    expect(c.troco).toBe(10); // 50 − 40, não 50 − 100
  });

  it('troco menor que a cobrança não vira troco negativo', () => {
    const c = calcularCobranca({ total: 60, pago: false, trocoPara: 50 });
    expect(c.troco).toBeNull();
  });

  it('pedido pré-pago com trocoPara residual não promete troco', () => {
    const c = calcularCobranca({ total: 60, pago: true, trocoPara: 100 });
    expect(c.aReceber).toBe(0);
    expect(c.troco).toBeNull();
  });

  it('prefere valorPagoCliente ao total quando o canal informou os dois', () => {
    // 99food: `total` e `valor_pago_cliente` podem divergir por taxa/desconto.
    const c = calcularCobranca({ total: 70, valorPagoCliente: 63.4, pago: false });
    expect(c.aReceber).toBe(63.4);
  });

  it('valores sujos (null, NaN, negativo) nunca viram cobrança', () => {
    expect(calcularCobranca({}).aReceber).toBe(0);
    expect(calcularCobranca({ total: null, pago: false }).aReceber).toBe(0);
    expect(calcularCobranca({ total: -10, pago: false }).aReceber).toBe(0);
    expect(calcularCobranca({ total: 'abc', pago: false }).aReceber).toBe(0);
  });

  it('pagamentos com valor sujo não somam lixo', () => {
    const c = calcularCobranca({
      total: 50,
      pago: false,
      pagamentos: [{ rotulo: 'Dinheiro', valor: null, prepago: false }],
    });
    expect(c.aReceber).toBe(0);
    expect(Number.isFinite(c.aReceber)).toBe(true);
  });

  it('arredonda em 2 casas (soma de centavos não vaza float)', () => {
    const c = calcularCobranca({
      total: 30,
      pago: false,
      pagamentos: [
        { rotulo: 'Dinheiro', valor: 10.1, prepago: false },
        { rotulo: 'Dinheiro', valor: 20.2, prepago: false },
      ],
    });
    expect(c.aReceber).toBe(30.3);
  });
});
