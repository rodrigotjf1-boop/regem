import { LARGO_ITF, PADRAO_ITF, barrasItf, lerBarrasItf } from './codigo-de-barras-itf';

// O código de barras do boleto (ITF, o padrão da FEBRABAN): a tabela de cada dígito, o início e o fim, e a volta das
// larguras para os dígitos com os códigos de barras do teste do boleto (calculados à mão).

const BANCARIO = '00197164100001284901234567890123456789012345';
const CONTA = '83640000004800001234567890123456789012345678';

describe('o código de barras ITF do boleto', () => {
  it('a tabela: cada dígito com 2 largos e 3 estreitos, todos diferentes', () => {
    const padroes = Object.values(PADRAO_ITF);
    expect(new Set(padroes).size).toBe(10);
    for (const p of padroes) {
      expect(p).toMatch(/^[NW]{5}$/);
      expect([...p].filter((c) => c === 'W')).toHaveLength(2);
    }
    // Os valores da tabela (o 1 = WNNNW e o 0 = NNWWN do padrão).
    expect(PADRAO_ITF['1']).toBe('WNNNW');
    expect(PADRAO_ITF['0']).toBe('NNWWN');
  });
  it('o início (4 estreitos), o fim (largo, estreito, estreito) e o tamanho do boleto de 44 dígitos', () => {
    const b = barrasItf(BANCARIO)!;
    expect(b.slice(0, 4)).toEqual([1, 1, 1, 1]);
    expect(b.slice(-3)).toEqual([LARGO_ITF, 1, 1]);
    // 4 do início + 22 pares × 10 elementos + 3 do fim; em módulos: 4 + 22 × 18 + 5.
    expect(b).toHaveLength(4 + 220 + 3);
    expect(b.reduce((s, x) => s + x, 0)).toBe(4 + 22 * 18 + 5);
  });
  it('as larguras voltam aos mesmos dígitos (o bancário e a conta)', () => {
    expect(lerBarrasItf(barrasItf(BANCARIO)!)).toBe(BANCARIO);
    expect(lerBarrasItf(barrasItf(CONTA)!)).toBe(CONTA);
  });
  it('o primeiro par do bancário: o 0 nas barras e o 0 nos espaços, intercalados', () => {
    // "00": barras NNWWN e espaços NNWWN → 1,1, 1,1, 3,3, 3,3, 1,1
    expect(barrasItf(BANCARIO)!.slice(4, 14)).toEqual([1, 1, 1, 1, 3, 3, 3, 3, 1, 1]);
  });
  it('não desenha o que não é código: letra, tamanho ímpar, vazio', () => {
    expect(barrasItf('0019716410000128490123456789012345678901234X')).toBeNull();
    expect(barrasItf('123')).toBeNull();
    expect(barrasItf('')).toBeNull();
    expect(lerBarrasItf([1, 1, 1])).toBeNull();
  });
});
