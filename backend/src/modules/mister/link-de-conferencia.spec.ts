import { acharPessoa, mensagemDoLink, resumoDaContagem } from './link-de-conferencia';

// O link de conferência (M3c.5, conversa 18 do protótipo v3): achar a pessoa pelo nome dito e a mensagem a quem recebe.

const PESSOAS = [{ nome: 'Carlos Lima' }, { nome: 'Dani Souza' }, { nome: 'Daniel Rocha' }, { nome: 'Édson Ferreira' }];

describe('achar a pessoa pelo nome dito', () => {
  it('o nome, o primeiro nome, com "o"/"pro" na frente, sem acento', () => {
    expect(acharPessoa('o Carlos', PESSOAS)).toEqual({ tipo: 'achou', pessoa: { nome: 'Carlos Lima' } });
    expect(acharPessoa('pro carlos lima', PESSOAS)).toEqual({ tipo: 'achou', pessoa: { nome: 'Carlos Lima' } });
    expect(acharPessoa('edson', PESSOAS)).toEqual({ tipo: 'achou', pessoa: { nome: 'Édson Ferreira' } });
  });
  it('"Dani" casa com duas pessoas: pergunta; o nome inteiro escolhe; quem não existe, nada', () => {
    expect(acharPessoa('Dani', PESSOAS)).toEqual({ tipo: 'escolher', opcoes: ['Dani Souza', 'Daniel Rocha'] });
    expect(acharPessoa('Dani Souza', PESSOAS)).toEqual({ tipo: 'achou', pessoa: { nome: 'Dani Souza' } });
    expect(acharPessoa('Zé', PESSOAS)).toEqual({ tipo: 'nenhum' });
    expect(acharPessoa('', PESSOAS)).toEqual({ tipo: 'nenhum' });
  });
});

describe('a mensagem a quem recebe', () => {
  it('o resumo da contagem (o protótipo: "42 itens, 3 com diferença")', () => {
    expect(resumoDaContagem({ itens: 42, contados: 42, comDiferenca: 3 })).toBe('42 itens, 3 com diferença');
    expect(resumoDaContagem({ itens: 1, contados: 0, comDiferenca: 0 })).toBe('1 item (0 contados), 0 com diferença');
  });
  it('quem pediu (o primeiro nome), o dia, a loja, o resumo e onde abre', () => {
    expect(mensagemDoLink({ quemPediu: 'Ana Souza', assunto: 'contagem_de_hoje', dia: '16/11', loja: 'Loja Centro', resumo: '42 itens, 3 com diferença' })).toBe(
      '📋 Ana pediu para você conferir a contagem de estoque de hoje, 16/11, na Loja Centro: 42 itens, 3 com diferença. Abre em Estoque › Contagem, com o seu usuário.',
    );
    expect(mensagemDoLink({ quemPediu: 'Ana', assunto: 'contagem_de_hoje', dia: '16/11', loja: 'todas as lojas', resumo: 'x' })).toContain('em todas as lojas');
  });
});
