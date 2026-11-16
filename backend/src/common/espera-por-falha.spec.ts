import { EsperaPorFalha } from './espera-por-falha';

// A espera crescente do que falha sempre (V84): as primeiras falhas não atrasam nada (a falha passageira tenta de novo no
// ciclo seguinte); a partir daí o item sai da consulta por 2, 4, 6… minutos, até o teto de 10.
describe('EsperaPorFalha', () => {
  const MIN = 60_000;
  const T0 = 1_800_000_000_000;

  it('as duas primeiras falhas tentam de novo na hora; depois a espera cresce até o teto', () => {
    const e = new EsperaPorFalha();
    expect([e.falhou('a', T0), e.falhou('a', T0), e.falhou('a', T0), e.falhou('a', T0), e.falhou('a', T0)]).toEqual([0, 0, 2 * MIN, 4 * MIN, 6 * MIN]);
    expect([e.falhou('a', T0), e.falhou('a', T0), e.falhou('a', T0), e.falhou('a', T0)]).toEqual([8 * MIN, 10 * MIN, 10 * MIN, 10 * MIN]);
    expect(e.vezes('a')).toBe(9);
  });

  it('só fica fora da consulta quem está esperando — e volta quando a espera vence', () => {
    const e = new EsperaPorFalha();
    e.falhou('a', T0);
    e.falhou('b', T0);
    e.falhou('b', T0);
    expect(e.emEspera(T0)).toEqual([]); // falhas imediatas: os dois tentam de novo no próximo ciclo
    e.falhou('b', T0); // a 3ª de b: 2 min de espera
    expect(e.emEspera(T0 + 1)).toEqual(['b']);
    expect(e.emEspera(T0 + 2 * MIN - 1)).toEqual(['b']);
    expect(e.emEspera(T0 + 2 * MIN)).toEqual([]);
    // Voltou e falhou de novo: a espera seguinte é maior (a contagem não zerou).
    expect(e.falhou('b', T0 + 2 * MIN)).toBe(4 * MIN);
  });

  it('deu certo: esquece as falhas; o item que falha depois recomeça da primeira', () => {
    const e = new EsperaPorFalha();
    for (let i = 0; i < 5; i++) e.falhou('a', T0);
    e.deuCerto('a');
    expect([e.vezes('a'), e.emEspera(T0 + 1), e.falhou('a', T0 + 2)]).toEqual([0, [], 0]);
  });

  it('o que não falha há mais de uma hora sai da memória (o pedido saiu da fila por outro caminho)', () => {
    const e = new EsperaPorFalha();
    for (let i = 0; i < 4; i++) e.falhou('a', T0);
    expect(e.emEspera(T0 + 61 * MIN)).toEqual([]);
    expect(e.vezes('a')).toBe(0);
  });

  it('os limites são do chamador: nenhuma tentativa imediata, passo e teto próprios', () => {
    const e = new EsperaPorFalha(0, 10_000, 25_000);
    expect([e.falhou('x', T0), e.falhou('x', T0), e.falhou('x', T0), e.falhou('x', T0)]).toEqual([10_000, 20_000, 25_000, 25_000]);
  });
});
