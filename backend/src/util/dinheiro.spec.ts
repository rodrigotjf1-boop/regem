import {
  paraCentavos,
  paraReais,
  somarCentavos,
  percentualCentavos,
} from './dinheiro';

// Prova que a conta em centavos bate ao centavo (sem drift de float).
describe('dinheiro (centavos)', () => {
  it('3× R$ 9,99 com cupom de 10% = R$ 26,97 exato', () => {
    // Em float: 9.99*3 = 29.970000000000002; *0.9 = 26.973000... → erro.
    const subtotal = somarCentavos(
      paraCentavos(9.99),
      paraCentavos(9.99),
      paraCentavos(9.99),
    );
    expect(subtotal).toBe(2997);
    const desconto = percentualCentavos(subtotal, 10); // 299.7 → 300
    expect(desconto).toBe(300);
    const total = somarCentavos(subtotal, -desconto);
    expect(total).toBe(2697);
    expect(paraReais(total)).toBe(26.97);
  });

  it('taxa R$ 6,90 + cashback parcial de R$ 5,50 sobre subtotal R$ 20,00', () => {
    const subtotal = paraCentavos(20.0); // 2000
    const taxa = paraCentavos(6.9); // 690
    const cashback = paraCentavos(5.5); // 550
    const total = somarCentavos(subtotal, -cashback, taxa); // 2000 - 550 + 690
    expect(total).toBe(2140);
    expect(paraReais(total)).toBe(21.4);
  });

  it('soma de 7 itens com promoção bate ao centavo', () => {
    // Preços "quebrados" que dariam drift somados como float.
    const precos = [3.33, 3.33, 3.33, 1.11, 1.11, 0.07, 0.07]; // = 12,35
    const subtotal = somarCentavos(...precos.map((p) => paraCentavos(p)));
    expect(subtotal).toBe(1235);
    // 15% de promoção
    const promo = percentualCentavos(subtotal, 15); // 185.25 → 185
    const total = somarCentavos(subtotal, -promo);
    expect(total).toBe(1050);
    expect(paraReais(total)).toBe(10.5);
    // Conferência: a soma float ingênua NÃO daria exatamente 12.35.
    const floatSoma = precos.reduce((a, b) => a + b, 0);
    expect(Math.round(floatSoma * 100)).toBe(subtotal);
  });
});
