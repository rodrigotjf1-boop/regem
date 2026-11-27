import { BadRequestException } from '@nestjs/common';
import { UNIDADES_ESTOQUE, conferirConversoes, exigirUnidade, normalizarUnidade } from './unidades';

// LISTA FECHADA de unidades de medida do estoque: o que já existe no banco e as abreviações das
// planilhas caem numa unidade da lista; o resto é recusado (não vira unidade nova).
describe('unidades de medida do estoque', () => {
  it('a lista não tem repetido e cada item é a própria forma normalizada', () => {
    expect(new Set(UNIDADES_ESTOQUE).size).toBe(UNIDADES_ESTOQUE.length);
    for (const u of UNIDADES_ESTOQUE) expect(normalizarUnidade(u)).toBe(u);
  });

  it('a fatia (pedido do dono, 27/11/2026: "não tem opção de fatia, somente fita") é da lista, e "fatias" cai nela', () => {
    expect(UNIDADES_ESTOQUE).toContain('fatia');
    expect(normalizarUnidade('Fatias')).toBe('fatia');
    expect(normalizarUnidade('fatia')).toBe('fatia');
    expect(normalizarUnidade('fita')).toBe('fita'); // a fita continua sendo outra unidade
  });

  it('reconhece o que as lojas já gravaram em texto livre', () => {
    expect(normalizarUnidade('L')).toBe('litro');
    expect(normalizarUnidade('pacotes')).toBe('pacote');
    expect(normalizarUnidade('un')).toBe('unidade');
    expect(normalizarUnidade(' Unidade ')).toBe('unidade');
    expect(normalizarUnidade('KG')).toBe('kg');
    expect(normalizarUnidade('g')).toBe('grama');
  });

  it('quilo, grama, litro e ml escritos de todo jeito ("k", "Kilos", "grs", "Mililitros")', () => {
    for (const texto of ['k', 'K', 'kg.', 'Kgs', 'kilo', 'Kilos', 'quilo', 'quilos', 'kilograma', 'Quilogramas']) expect([texto, normalizarUnidade(texto)]).toEqual([texto, 'kg']);
    for (const texto of ['g', 'gr', 'grs', 'Gramas']) expect([texto, normalizarUnidade(texto)]).toEqual([texto, 'grama']);
    for (const texto of ['l', 'L', 'Litros']) expect([texto, normalizarUnidade(texto)]).toEqual([texto, 'litro']);
    for (const texto of ['ML', 'mililitro', 'Mililitros']) expect([texto, normalizarUnidade(texto)]).toEqual([texto, 'ml']);
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

  it('EST-A-02: conversões que se contradizem são recusadas em qualquer ordem; a cadeia que fecha passa', () => {
    const caixa2kg = { unidadeDe: 'caixa', fator: 2, unidadePara: 'kg' };
    const pacote3kg = { unidadeDe: 'pacote', fator: 3, unidadePara: 'kg' };
    const caixa4pacotes = { unidadeDe: 'caixa', fator: 4, unidadePara: 'pacote' };
    expect(() => conferirConversoes([caixa2kg, pacote3kg, caixa4pacotes])).toThrow(/se contradizem/);
    expect(() => conferirConversoes([caixa4pacotes, pacote3kg, caixa2kg])).toThrow(/se contradizem/);
    expect(conferirConversoes([caixa2kg, caixa4pacotes])).toHaveLength(2); // 1 pacote = 0,5 kg, sem outro caminho
    // Pela medida fixa: 1 galão = 30 ml e 1 galão = 3,3 litro não fecham (o caso real que a régua acha).
    expect(() =>
      conferirConversoes([
        { unidadeDe: 'galão', fator: 30, unidadePara: 'ml' },
        { unidadeDe: 'galão', fator: 3.3, unidadePara: 'litro' },
      ]),
    ).toThrow(/se contradizem/);
    expect(conferirConversoes([{ unidadeDe: 'galão', fator: 3300, unidadePara: 'ml' }, { unidadeDe: 'galão', fator: 3.3, unidadePara: 'litro' }])).toHaveLength(2);
    // A cadeia longa da loja (caixa → kg → fita → unidade, porção → fita) fecha.
    expect(
      conferirConversoes([
        { unidadeDe: 'caixa', fator: 9, unidadePara: 'kg' },
        { unidadeDe: 'fita', fator: 1, unidadePara: 'unidade' },
        { unidadeDe: 'kg', fator: 72, unidadePara: 'fita' },
        { unidadeDe: 'porção', fator: 2, unidadePara: 'fita' },
      ]),
    ).toHaveLength(4);
  });
});
