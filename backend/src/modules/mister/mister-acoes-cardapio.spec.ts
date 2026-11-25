import { apresentacaoDaPromocao, conferirCardapio, conferirPromocao, resumoDaPromocao, resumoDoProdutoNovo } from './mister-acoes-cardapio';
import { ACOES, conferirAcao } from './mister-acoes';

describe('o cardápio pela conversa (etapa 7 de 24/11)', () => {
  it('criar é de botão e a promoção é de PIN com "Ver valores", pela permissão de Cadastros › Cardápio', () => {
    expect(ACOES.criar_categoria).toMatchObject({ nivel: 'botao', permissao: 'loja' });
    expect(ACOES.criar_produto).toMatchObject({ nivel: 'botao', permissao: 'loja' });
    expect(ACOES.promocao_do_produto).toMatchObject({ nivel: 'pin', permissao: 'loja', pedeVerValores: true });
  });

  it('a categoria e o produto novos: o nome, o preço e o resto opcional', () => {
    expect(conferirCardapio('criar_categoria', {})).toEqual({ erro: 'Diga o nome da categoria nova.' });
    expect(conferirCardapio('criar_categoria', { nomeDaCategoria: '  Sobremesas ' })).toEqual({
      parametros: { acao: 'criar_categoria', nome: 'Sobremesas' },
      resumo: 'Criar a categoria "Sobremesas" em Cadastros › Cardápio.',
    });
    expect(conferirCardapio('criar_produto', { nomeDoProduto: 'Smash' })).toEqual({ erro: 'Diga o preço de venda do produto novo, em reais.' });
    expect(conferirCardapio('criar_produto', { nomeDoProduto: 'Smash', precoDoProduto: -3 })).toEqual({ erro: 'Diga o preço de venda do produto novo, em reais.' });
    expect(conferirCardapio('criar_produto', { nomeDoProduto: 'Smash Duplo', precoDoProduto: 34.904, categoriaDoProduto: 'Burgers' })).toEqual({
      parametros: { acao: 'criar_produto', nome: 'Smash Duplo', preco: 34.9, categoria: 'Burgers', descricao: null },
      resumo: 'Criar o produto "Smash Duplo" por R$ 34,90 na categoria "Burgers".',
    });
    expect(conferirAcao('criar_produto', { nomeDoProduto: 'Smash', precoDoProduto: 20 })).toMatchObject({ parametros: { categoria: null } });
  });

  it('a promoção: o preço "por" ou tirar', () => {
    expect(conferirCardapio('promocao_do_produto', { produto: 'X-Bacon' })).toEqual({ erro: 'Diga o preço da promoção (o "por"), em reais — ou que é para tirar a promoção.' });
    expect(conferirCardapio('promocao_do_produto', { produto: 'X-Bacon', precoPromocional: 25.9 })).toEqual({
      parametros: { acao: 'promocao_do_produto', produto: 'X-Bacon', precoPromocional: 25.9 },
      resumo: 'Pôr "X-Bacon" em promoção por R$ 25,90.',
    });
    expect(conferirCardapio('promocao_do_produto', { produto: 'X-Bacon', tirarPromocao: true })).toMatchObject({ parametros: { precoPromocional: null } });
    const x = { nome: 'X-Bacon', precoVenda: 32.9, precoPromocional: null };
    expect(conferirPromocao(x, 25.9)).toBeNull();
    expect(conferirPromocao(x, 32.9)).toBe('A promoção tem de ser menor que o preço normal de "X-Bacon" (R$ 32,90).');
    expect(conferirPromocao(x, null)).toBe('"X-Bacon" não está em promoção.');
    expect(conferirPromocao({ ...x, precoPromocional: 25.9 }, 25.9)).toBe('"X-Bacon" já está em promoção por R$ 25,90.');
    expect(conferirPromocao({ ...x, precoPromocional: 25.9 }, null)).toBeNull();
  });

  it('os resumos e a página do PIN dizem onde vale e que não tem data de fim', () => {
    expect(resumoDoProdutoNovo({ nome: 'Smash', preco: 20, descricao: null }, null)).toBe(
      'Criar o produto "Smash" por R$ 20,00 sem categoria. Ele entra no cardápio sem foto, sem ficha técnica, sem código PDV e sem baixa no estoque: o resto do cadastro fica em Cadastros › Cardápio.',
    );
    const x = { nome: 'X-Bacon', precoVenda: 32.9, precoPromocional: null };
    expect(resumoDaPromocao(x, 25.9)).toBe(
      'Pôr "X-Bacon" em promoção no cardápio digital: de R$ 32,90 por R$ 25,90. Fica ligada até alguém tirar (o Regem não tem promoção com data de fim). O preço do iFood e da 99 não muda.',
    );
    expect(resumoDaPromocao({ ...x, precoPromocional: 25.9 }, null)).toBe('Tirar a promoção de "X-Bacon": o preço volta a R$ 32,90 no cardápio digital (estava por R$ 25,90).');
    expect(apresentacaoDaPromocao({ nomeDoProduto: 'X-Bacon', precoVenda: 32.9, precoPromocional: 25.9 })).toMatchObject({ titulo: 'Pôr em promoção', valor: 25.9, botao: 'Pôr em promoção' });
    expect(apresentacaoDaPromocao({ nomeDoProduto: 'X-Bacon', precoVenda: 32.9, precoPromocional: null })).toMatchObject({ titulo: 'Tirar a promoção', valor: null });
  });
});
