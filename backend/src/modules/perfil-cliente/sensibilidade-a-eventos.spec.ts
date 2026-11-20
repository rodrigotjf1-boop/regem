import { diaDaSemana, somarDias } from './calendario-regra';
import { benjaminiHochberg, gamaQ, medirSensibilidades } from './sensibilidade-a-eventos';

// O que move o cliente (F3 parte 2 do plano do perfil do cliente): a estatística e o método.
describe('sensibilidade a eventos', () => {
  it('a gama incompleta regularizada (cauda de cima) confere com os valores fechados', () => {
    expect(gamaQ(1, 1)).toBeCloseTo(Math.exp(-1), 6);
    expect(gamaQ(2, 1)).toBeCloseTo(2 * Math.exp(-1), 6);
    expect(gamaQ(3, 2)).toBeCloseTo(5 * Math.exp(-2), 6);
    expect(gamaQ(0.5, 0.5)).toBeCloseTo(0.317311, 5); // erfc(√½)
    expect(gamaQ(10, 15)).toBeCloseTo(0.069854, 5); // P(Poisson(15) ≤ 9) — o ramo da fração contínua
    expect(gamaQ(5, 0)).toBe(1);
  });

  it('Benjamini-Hochberg: passa até o maior p(r) ≤ r/m·q', () => {
    expect(benjaminiHochberg([0.01, 0.04, 0.03, 0.2], 0.1)).toEqual([true, true, true, false]);
    expect(benjaminiHochberg([0.5, 0.6], 0.1)).toEqual([false, false]);
    expect(benjaminiHochberg([], 0.1)).toEqual([]);
  });

  // Seis meses; dinheiro no bolso nos dias 5 e 20 de cada mês.
  const INICIO = '2026-01-01';
  const ATE = '2026-06-30';
  const dias: string[] = [];
  for (let d = INICIO; d <= ATE; d = somarDias(d, 1)) dias.push(d);
  const cal = new Map(dias.map((d) => [d, new Set(['05', '20'].includes(d.slice(8)) ? ['dinheiro'] : [])]));
  const calendarios = new Map([['L', cal]]);
  const eventos = dias.filter((d) => cal.get(d)!.size);

  it('o cliente que pede justamente no dinheiro no bolso ganha o selo; o que pede todo dia, não', () => {
    // A: pede em todos os dias de dinheiro e, fora deles, só às quartas-feiras alternadas.
    const pedidosA = new Map<string, number>(eventos.map((d) => [d, 1]));
    let alterna = false;
    for (const d of dias) if (!cal.get(d)!.size && diaDaSemana(d) === 3 && (alterna = !alterna)) pedidosA.set(d, 1);
    // B: pede todo dia, igual.
    const pedidosB = new Map<string, number>(dias.map((d) => [d, 1]));
    const { linhas, rrDaLoja } = medirSensibilidades(
      [
        { id: 'A', loja: 'L', inicio: INICIO, pedidos: pedidosA },
        { id: 'B', loja: 'L', inicio: INICIO, pedidos: pedidosB },
      ],
      calendarios,
      ATE,
    );
    expect(rrDaLoja.dinheiro.mede).toBe(true);
    expect(rrDaLoja.dinheiro.dias).toBe(12);
    const a = linhas.find((l) => l.cliente === 'A')!;
    const b = linhas.find((l) => l.cliente === 'B')!;
    expect(a).toMatchObject({ tipo: 'dinheiro', pedidos: 12, dias: 12, selo: true });
    expect(a.prob).toBeGreaterThan(0.99);
    expect(a.rr).toBeGreaterThan(3);
    // B pede igual todo dia: o RR encolhido fica perto de 1 e a chance não chega a 0,9.
    expect(b.selo).toBe(false);
    expect(b.prob).toBeLessThan(0.9);
    // Os tipos sem dia no período não são medidos.
    expect(rrDaLoja.feriado.mede).toBe(false);
  });

  it('primeiro a loja: se o tipo não mexe na loja, nenhum cliente é medido nele', () => {
    const todoDia = new Map<string, number>(dias.map((d) => [d, 1]));
    const r = medirSensibilidades([{ id: 'B', loja: 'L', inicio: INICIO, pedidos: todoDia }], calendarios, ATE);
    expect(r.rrDaLoja.dinheiro).toMatchObject({ mede: false });
    expect(r.rrDaLoja.dinheiro.rr).toBeCloseTo(1, 5);
    expect(r.linhas).toEqual([]);
  });

  it('sem 3 dias de evento com pedido, não há selo; sem pedido em dia comum, não há o que comparar', () => {
    // A (como no primeiro caso) faz a loja "mexer" no dinheiro no bolso.
    const pedidosA = new Map<string, number>(eventos.map((d) => [d, 1]));
    let alterna = false;
    for (const d of dias) if (!cal.get(d)!.size && diaDaSemana(d) === 3 && (alterna = !alterna)) pedidosA.set(d, 1);
    // C: pede toda segunda comum e em só DOIS dias de dinheiro (3 pedidos em cada) — 05/01 é segunda.
    const pedidosC = new Map<string, number>([[eventos[0], 3], [eventos[1], 3]]);
    for (const d of dias) if (!cal.get(d)!.size && diaDaSemana(d) === 1) pedidosC.set(d, 1);
    // E: pede só em dia de dinheiro — nenhum dia comum, o esperado é 0: não dá para medir.
    const pedidosE = new Map<string, number>(eventos.map((d) => [d, 1]));
    const { linhas } = medirSensibilidades(
      [
        { id: 'A', loja: 'L', inicio: INICIO, pedidos: pedidosA },
        { id: 'C', loja: 'L', inicio: INICIO, pedidos: pedidosC },
        { id: 'E', loja: 'L', inicio: INICIO, pedidos: pedidosE },
      ],
      calendarios,
      ATE,
    );
    const c = linhas.find((l) => l.cliente === 'C')!;
    expect(c).toMatchObject({ pedidos: 6, dias: 2, selo: false });
    expect(linhas.find((l) => l.cliente === 'E')).toBeUndefined();
  });

  it('o cliente que começou no meio do período só conta os dias desde o primeiro dele', () => {
    const pedidosA = new Map<string, number>(eventos.map((d) => [d, 1]));
    let alterna = false;
    for (const d of dias) if (!cal.get(d)!.size && diaDaSemana(d) === 3 && (alterna = !alterna)) pedidosA.set(d, 1);
    // G: desde 01/06, pede todo dia comum e nos dois dias de dinheiro de junho (05 e 20).
    const pedidosG = new Map<string, number>();
    for (const d of dias) if (d >= '2026-06-01') pedidosG.set(d, 1);
    const g = medirSensibilidades(
      [
        { id: 'A', loja: 'L', inicio: INICIO, pedidos: pedidosA },
        { id: 'G', loja: 'L', inicio: '2026-06-01', pedidos: pedidosG },
      ],
      calendarios,
      ATE,
    ).linhas.find((l) => l.cliente === 'G')!;
    // Os dias de dinheiro antes de junho não entram nem no esperado nem nos dias.
    expect(g).toMatchObject({ pedidos: 2, dias: 2, selo: false });
    expect(g.esperado).toBeCloseTo(2, 5);
  });
});
