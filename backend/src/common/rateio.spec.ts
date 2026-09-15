import { ratearCentavos, ratearReais } from './rateio';

// O contrato do rateio é "a soma das partes fecha com o total, sempre". É isso que a
// SEFAZ valida na NFC-e (vDesc/vFrete do total = somatório dos itens), então os testes
// atacam justamente os casos em que um rateio ingênuo em float não fecharia.
describe('ratearCentavos', () => {
  const soma = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it('divide proporcionalmente quando a conta é exata', () => {
    expect(ratearCentavos([1000, 3000], 400)).toEqual([100, 300]);
  });

  it('fecha a soma mesmo com dízima (3 linhas iguais, 10 centavos)', () => {
    const r = ratearCentavos([100, 100, 100], 10);
    expect(soma(r)).toBe(10);
    expect(r).toEqual([4, 3, 3]);
  });

  it('nunca perde nem cria centavo, em 1000 combinações', () => {
    for (let n = 1; n <= 10; n++) {
      for (let t = 0; t <= 99; t++) {
        const bases = Array.from({ length: n }, (_, i) => (i + 1) * 137);
        expect(soma(ratearCentavos(bases, t))).toBe(t);
      }
    }
  });

  it('erro máximo de 1 centavo por linha', () => {
    const bases = [1234, 5678, 91011];
    const total = 777;
    const r = ratearCentavos(bases, total);
    const somaBases = soma(bases);
    r.forEach((parte, i) => {
      const exato = (total * bases[i]) / somaBases;
      expect(Math.abs(parte - exato)).toBeLessThan(1);
    });
  });

  it('base zerada não recebe rateio quando há outra base positiva', () => {
    expect(ratearCentavos([0, 500], 100)).toEqual([0, 100]);
  });

  it('todas as bases zeradas → divide igual e ainda fecha', () => {
    const r = ratearCentavos([0, 0, 0], 100);
    expect(soma(r)).toBe(100);
    expect(r).toEqual([34, 33, 33]);
  });

  it('ignora base negativa, NaN e Infinity (tratadas como peso 0)', () => {
    const r = ratearCentavos([-500, NaN, Infinity, 1000], 60);
    expect(r).toEqual([0, 0, 0, 60]);
    expect(soma(r)).toBe(60);
  });

  it('total zero ou negativo devolve zeros (desconto não vira crédito)', () => {
    expect(ratearCentavos([100, 200], 0)).toEqual([0, 0]);
    expect(ratearCentavos([100, 200], -50)).toEqual([0, 0]);
  });

  it('lista vazia devolve lista vazia', () => {
    expect(ratearCentavos([], 100)).toEqual([]);
  });

  it('é determinístico — mesma entrada, mesma saída', () => {
    const bases = [333, 333, 333, 1];
    const a = ratearCentavos(bases, 101);
    for (let i = 0; i < 20; i++) expect(ratearCentavos(bases, 101)).toEqual(a);
  });

  it('desconto igual ao bruto zera cada linha exatamente (sem centavo sobrando)', () => {
    const bases = [1999, 3, 4567];
    const r = ratearCentavos(bases, soma(bases));
    expect(r).toEqual(bases); // cada linha absorve exatamente o próprio valor
  });
});

describe('ratearReais', () => {
  it('fecha em reais com 2 casas', () => {
    const r = ratearReais([19.99, 5.5, 3.01], 4.37);
    expect(Number(r.reduce((a, b) => a + b, 0).toFixed(2))).toBe(4.37);
  });

  it('caso clássico de float: 0,10 entre 3 itens iguais', () => {
    const r = ratearReais([10, 10, 10], 0.1);
    expect(r).toEqual([0.04, 0.03, 0.03]);
    expect(Number(r.reduce((a, b) => a + b, 0).toFixed(2))).toBe(0.1);
  });
});
