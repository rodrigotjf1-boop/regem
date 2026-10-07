import { BadRequestException } from '@nestjs/common';
import { UNIDADES_ESTOQUE, exigirUnidade, normalizarUnidade } from './unidades';

// LISTA FECHADA de unidades de medida do estoque: o que já existe no banco e as abreviações das
// planilhas caem numa unidade da lista; o resto é recusado (não vira unidade nova).
describe('unidades de medida do estoque', () => {
  it('a lista não tem repetido e cada item é a própria forma normalizada', () => {
    expect(new Set(UNIDADES_ESTOQUE).size).toBe(UNIDADES_ESTOQUE.length);
    for (const u of UNIDADES_ESTOQUE) expect(normalizarUnidade(u)).toBe(u);
  });

  it('reconhece o que as lojas já gravaram em texto livre', () => {
    expect(normalizarUnidade('L')).toBe('litro');
    expect(normalizarUnidade('pacotes')).toBe('pacote');
    expect(normalizarUnidade('un')).toBe('unidade');
    expect(normalizarUnidade(' Unidade ')).toBe('unidade');
    expect(normalizarUnidade('KG')).toBe('kg');
    expect(normalizarUnidade('g')).toBe('grama');
  });

  it('reconhece as abreviações de planilha, com ou sem ponto e acento', () => {
    const pares: [string, string][] = [
      ['und', 'unidade'], ['cx', 'caixa'], ['pct', 'pacote'], ['Pct.', 'pacote'], ['gl', 'galão'],
      ['rl', 'rolo'], ['pt', 'pote'], ['sc', 'saco'], ['pç', 'peça'], ['PC', 'peça'], ['bisnaga', 'bisnaga'],
      ['galao', 'galão'], ['duzia', 'dúzia'], ['MACO', 'maço'], ['porcao', 'porção'], ['fardo', 'fardo'],
    ];
    for (const [texto, unidade] of pares) expect([texto, normalizarUnidade(texto)]).toEqual([texto, unidade]);
  });

  it('abreviação ambígua e texto inventado NÃO viram unidade', () => {
    for (const texto of ['lt', 'ct', 'bandejinha', 'caixa grande', '', '   ', '12'])
      expect([texto, normalizarUnidade(texto)]).toEqual([texto, null]);
    expect(normalizarUnidade(undefined)).toBeNull();
    expect(normalizarUnidade(5)).toBeNull();
  });

  it('exigirUnidade devolve a da lista ou recusa com 400 dizendo o que veio', () => {
    expect(exigirUnidade('cx', 'Unidade principal')).toBe('caixa');
    expect(() => exigirUnidade('bandejinha', 'Unidade principal')).toThrow(BadRequestException);
    expect(() => exigirUnidade('bandejinha', 'Unidade principal')).toThrow(/Unidade principal.*"bandejinha".*lista/);
    expect(() => exigirUnidade(undefined, 'Conversão')).toThrow(/Conversão.*vazia/);
  });
});
