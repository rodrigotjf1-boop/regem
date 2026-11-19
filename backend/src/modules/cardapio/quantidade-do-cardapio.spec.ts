import { QUANTIDADE_MAXIMA_DO_CARDAPIO, quantidadeDoCardapio } from './quantidade-do-cardapio';

// R3-H02 (ERR-533): a quantidade do pedido do cardápio só vale inteira, de 1 a 9.999; ausente = 1.
describe('a quantidade do item do pedido do cardápio (R3-H02)', () => {
  it('ausente ou vazia vale 1, como sempre', () => {
    for (const v of [undefined, null, '']) expect(quantidadeDoCardapio(v)).toBe(1);
  });

  it('inteiro de 1 a 9.999, número ou texto', () => {
    expect(quantidadeDoCardapio(1)).toBe(1);
    expect(quantidadeDoCardapio(3)).toBe(3);
    expect(quantidadeDoCardapio('12')).toBe(12);
    expect(quantidadeDoCardapio(' 7 ')).toBe(7);
    expect(quantidadeDoCardapio(QUANTIDADE_MAXIMA_DO_CARDAPIO)).toBe(9999);
  });

  it('negativa, zero, fração, gigante, NaN, infinito e tipo errado: não vale', () => {
    for (const v of [-1, -5, '-2', 0, '0', 0.5, 1.5, '2,5', 10000, 1e9, NaN, Infinity, -Infinity, 'abc', true, {}, [], [2]])
      expect(quantidadeDoCardapio(v)).toBeNull();
  });
});
