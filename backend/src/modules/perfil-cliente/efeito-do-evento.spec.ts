import { somarDias } from './calendario-regra';
import { comReservaDoTipo, familiaDe, medirEfeito } from './efeito-do-evento';

// "Mexe na sua loja?" (F3, parte 1, do plano do perfil do cliente): o dia do evento contra o mesmo dia da semana nas 8
// semanas antes, sem evento.
describe('o efeito do evento na loja', () => {
  const EVENTO = '2026-10-12'; // segunda-feira
  const semanas = (dia: string, n: number) => Array.from({ length: n }, (_, k) => somarDias(dia, -7 * (k + 1)));
  const pedidos = (pares: [string, number][]) => new Map(pares);

  it('a família: o mesmo evento em outros anos e meses, ou as repetições do evento da loja', () => {
    expect(familiaDe('regra:feriado:aparecida:2026')).toBe('regra:feriado:aparecida');
    expect(familiaDe('regra:dinheiro:salario:2026-11')).toBe('regra:dinheiro:salario');
    expect(familiaDe('loja:abc:2026-11-26')).toBe('loja:abc');
    expect(familiaDe('escala:xyz:2026-11-26')).toBe('escala:xyz');
  });

  it('compara com a média do mesmo dia da semana; diz quantas vezes mediu e chama de pouco histórico', () => {
    const ref = semanas(EVENTO, 8).map((d) => [d, 10] as [string, number]);
    const e = medirEfeito([EVENTO], pedidos([[EVENTO, 15], ...ref]), new Set([EVENTO]), ref[ref.length - 1][0]);
    expect(e).toMatchObject({ vezes: 1, forca: 'fraco', texto: '+50% na última vez · pouco histórico' });
    expect(e.variacao).toBeCloseTo(0.5);
  });

  it('os dias com outro evento ficam fora da referência; sem 3 dias comuns, não compara', () => {
    const ref = semanas(EVENTO, 8);
    const p = pedidos([[EVENTO, 15], ...ref.map((d) => [d, 10] as [string, number])]);
    // Seis das oito semanas com evento: sobram 2 — não dá para comparar.
    const comEvento = new Set([EVENTO, ...ref.slice(0, 6)]);
    expect(medirEfeito([EVENTO], p, comEvento, ref[7])).toMatchObject({ vezes: 0, forca: 'sem_comparacao' });
    // Com uma semana de referência fora por evento de 30 pedidos, a média fica nos 10 dos dias comuns.
    const p2 = new Map(p);
    p2.set(ref[0], 30);
    expect(medirEfeito([EVENTO], p2, new Set([EVENTO, ref[0]]), ref[7]).variacao).toBeCloseTo(0.5);
  });

  it('sem histórico, ruído do dia a dia, antes do primeiro dia dos dados e a loja fechada naquele dia', () => {
    expect(medirEfeito([], new Map(), new Set(), null)).toMatchObject({ forca: 'sem_historico', texto: 'sem histórico ainda' });
    const ref = semanas(EVENTO, 8).map((d) => [d, 100] as [string, number]);
    expect(medirEfeito([EVENTO], pedidos([[EVENTO, 103], ...ref]), new Set([EVENTO]), ref[7][0])).toMatchObject({ forca: 'sem_efeito', texto: 'sem efeito medido (na última vez)' });
    // O primeiro dia dos dados DEPOIS do evento: a loja nem usava o Regem — nada a medir.
    expect(medirEfeito([EVENTO], pedidos(ref), new Set(), somarDias(EVENTO, 1))).toMatchObject({ vezes: 0 });
    // Sem pedido nenhum nesse dia da semana (a loja não abre): a referência zerada não compara.
    const zerado = semanas(EVENTO, 8).map((d) => [d, 0] as [string, number]);
    expect(medirEfeito([EVENTO], pedidos([[EVENTO, 5], ...zerado, ['2026-01-01', 1]]), new Set([EVENTO]), '2026-01-01')).toMatchObject({ vezes: 0, forca: 'sem_comparacao' });
  });

  it('a reserva pelo tipo: o feriado sem vez anterior usa os outros feriados, dizendo isso; com medida própria, fica a própria', () => {
    const doTipo = { vezes: 3, variacao: 1.1, forca: 'medio', texto: '+110% nas últimas 3 vezes' } as const;
    const semVez = { vezes: 0, variacao: null, forca: 'sem_historico', texto: 'sem histórico ainda' } as const;
    expect(comReservaDoTipo(semVez, doTipo, 'feriado')).toMatchObject({ escopo: 'tipo', vezes: 3, texto: 'feriados em geral: +110% nas últimas 3 vezes' });
    const proprio = { vezes: 1, variacao: 0.4, forca: 'fraco', texto: '+40% na última vez · pouco histórico' } as const;
    expect(comReservaDoTipo(proprio, doTipo, 'feriado')).toMatchObject({ escopo: 'evento', texto: '+40% na última vez · pouco histórico' });
    // O tipo também sem medida, ou evento da loja (sem tipo da regra): fica o "sem histórico".
    expect(comReservaDoTipo(semVez, { ...semVez }, 'feriado')).toMatchObject({ escopo: 'evento', texto: 'sem histórico ainda' });
    expect(comReservaDoTipo(semVez, undefined, 'promocao')).toMatchObject({ escopo: 'evento' });
  });

  it('várias vezes: soma as vezes (força média com 3, forte com 6) e a queda aparece com o sinal', () => {
    const vezes = ['2026-01-05', '2026-04-06', '2026-07-06'];
    const pares: [string, number][] = [];
    for (const v of vezes) pares.push([v, 8], ...semanas(v, 8).map((d) => [d, 10] as [string, number]));
    const e = medirEfeito(vezes, pedidos(pares), new Set(vezes), '2025-01-01');
    expect(e).toMatchObject({ vezes: 3, forca: 'medio', texto: '−20% nas últimas 3 vezes' });
  });
});
