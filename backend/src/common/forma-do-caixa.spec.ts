import { formaDoCaixa, somarPorFormaDoCaixa } from './forma-do-caixa';

// A chave de conferência da forma no caixa (PDV-C-01): o nome do cadastro, o tipo do delivery e o que a tela conta caem na
// MESMA chave — senão o fechamento abre uma linha para "Dinheiro" e outra para "dinheiro".
describe('formaDoCaixa', () => {
  it('nome do cadastro, tipo e o que a tela conta dão a mesma chave', () => {
    expect(['Dinheiro', 'dinheiro', 'DINHEIRO', ' Dinheiro ', 'cash', 'Espécie'].map(formaDoCaixa)).toEqual(Array(6).fill('dinheiro'));
    expect(['Pix', 'pix', 'PIX'].map(formaDoCaixa)).toEqual(['pix', 'pix', 'pix']);
    expect(['Cartão de crédito', 'Cartão de débito', 'credito', 'debito', 'cartao', 'credit_card'].map(formaDoCaixa)).toEqual(Array(6).fill('cartao'));
    expect(formaDoCaixa('Vale-refeição')).toBe('vr');
  });
  it('vazia é dinheiro (a regra antiga do fechamento); forma própria da loja fica pelo nome em minúsculas', () => {
    expect(formaDoCaixa(null)).toBe('dinheiro');
    expect(formaDoCaixa('')).toBe('dinheiro');
    expect(formaDoCaixa(' Fiado ')).toBe('fiado');
  });
  it('soma pela chave', () => {
    expect(somarPorFormaDoCaixa({ Dinheiro: 5000, dinheiro: 10000, Pix: 300, 'Cartão de crédito': 200, debito: 100 })).toEqual({
      dinheiro: 15000,
      pix: 300,
      cartao: 300,
    });
  });
});
