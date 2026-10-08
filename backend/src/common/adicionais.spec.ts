import {
  agruparEscolhas,
  descricaoTrazEscolhas,
  rotuloDaEscolha,
  textoDasEscolhas,
  vezesPorOpcao,
} from './adicionais';

describe('adicionais — repetição e texto das escolhas', () => {
  describe('vezesPorOpcao', () => {
    it('conta a repetição onde a etapa permite e mantém a ordem da primeira escolha', () => {
      const vezes = vezesPorOpcao(['bacon', 'queijo', 'bacon', 'bacon'], () => true);
      expect([...vezes.entries()]).toEqual([
        ['bacon', 3],
        ['queijo', 1],
      ]);
    });

    it('onde a etapa não permite repetir, a opção conta uma vez', () => {
      const vezes = vezesPorOpcao(['bacon', 'bacon', 'queijo', 'queijo'], (id) => id === 'queijo');
      expect(vezes.get('bacon')).toBe(1);
      expect(vezes.get('queijo')).toBe(2);
    });

    it('ignora id vazio e lista ausente', () => {
      expect(vezesPorOpcao(['', null, undefined, 'a'], () => true).size).toBe(1);
      expect(vezesPorOpcao(undefined as any, () => true).size).toBe(0);
    });
  });

  it('rotuloDaEscolha escreve a quantidade só quando repete', () => {
    expect(rotuloDaEscolha('Bacon', 1)).toBe('Bacon');
    expect(rotuloDaEscolha('Bacon', 2)).toBe('2x Bacon');
  });

  it('agruparEscolhas junta a mesma escolha e separa "sem" de "+"', () => {
    expect(
      agruparEscolhas([
        { tipo: 'adicionar', nome: 'Bacon' },
        { tipo: 'remover', nome: 'Cebola' },
        { tipo: 'adicionar', nome: 'Bacon' },
        { tipo: 'escolha', nome: 'Refrigerante' },
      ]),
    ).toEqual([
      { tipo: 'adicionar', nome: 'Bacon', vezes: 2 },
      { tipo: 'remover', nome: 'Cebola', vezes: 1 },
      { tipo: 'adicionar', nome: 'Refrigerante', vezes: 1 },
    ]);
  });

  describe('textoDasEscolhas', () => {
    it('uma escolha de cada: o texto de sempre', () => {
      expect(
        textoDasEscolhas([
          { tipo: 'adicionar', nome: 'Bacon' },
          { tipo: 'remover', nome: 'Cebola' },
        ]),
      ).toBe('+ Bacon · sem Cebola');
    });

    it('repetida: "+ 2x Bacon" em vez de "+ Bacon · + Bacon"', () => {
      expect(
        textoDasEscolhas([
          { tipo: 'adicionar', nome: 'Bacon' },
          { tipo: 'adicionar', nome: 'Bacon' },
        ]),
      ).toBe('+ 2x Bacon');
    });

    it('sem escolha: null', () => {
      expect(textoDasEscolhas([])).toBeNull();
      expect(textoDasEscolhas([], 'Produto Fictício')).toBeNull();
    });

    it('pedido do nosso cardápio (escolhas na descrição): não repete o texto', () => {
      const comps = [
        { tipo: 'adicionar', nome: 'Sem cebola' },
        { tipo: 'adicionar', nome: 'Bacon' },
        { tipo: 'adicionar', nome: 'Bacon' },
      ];
      // O cardápio escreve na ordem da escolha; o banco devolve em qualquer ordem.
      expect(textoDasEscolhas(comps, 'Lanche Fictício · Grande (2x Bacon, Sem cebola)')).toBeNull();
      expect(textoDasEscolhas(comps, 'Lanche Fictício (Sem cebola, 2x Bacon)')).toBeNull();
    });

    it('venda do balcão (descrição é só o nome do produto): escreve o texto', () => {
      const comps = [{ tipo: 'adicionar', nome: 'Bacon' }];
      expect(textoDasEscolhas(comps, 'Lanche Fictício')).toBe('+ Bacon');
      // Produto cujo NOME termina em parênteses não engana a regra.
      expect(textoDasEscolhas(comps, 'Refrigerante Fictício (lata)')).toBe('+ Bacon');
    });
  });

  describe('descricaoTrazEscolhas', () => {
    const bacon2 = [
      { tipo: 'adicionar', nome: 'Bacon' },
      { tipo: 'adicionar', nome: 'Bacon' },
    ];

    it('só vale com a lista exata', () => {
      expect(descricaoTrazEscolhas('Lanche Fictício (2x Bacon)', bacon2)).toBe(true);
      // uma fatia a menos na descrição
      expect(descricaoTrazEscolhas('Lanche Fictício (Bacon)', bacon2)).toBe(false);
      // escolha a mais na descrição
      expect(descricaoTrazEscolhas('Lanche Fictício (2x Bacon, Queijo)', bacon2)).toBe(false);
      // parte do nome do produto não conta
      expect(descricaoTrazEscolhas('Lanche com 2x Bacon)', bacon2)).toBe(false);
    });

    it('sem escolha gravada, a descrição nunca "traz"', () => {
      expect(descricaoTrazEscolhas('Lanche Fictício (2x Bacon)', [])).toBe(false);
      expect(descricaoTrazEscolhas(null, bacon2)).toBe(false);
    });

    it('nome de opção com vírgula continua comparável', () => {
      const comps = [{ tipo: 'adicionar', nome: 'Alface, tomate' }, { tipo: 'adicionar', nome: 'Bacon' }];
      expect(descricaoTrazEscolhas('Lanche Fictício (Bacon, Alface, tomate)', comps)).toBe(true);
    });
  });
});
