import { ACOES, conferirAcao, ehCadastro } from './mister-acoes';
import { conferirCadastro } from './mister-acoes-cadastro';

// Versão 9, O3: o cadastro pela conversa. A IA manda o que entendeu; aqui se confere antes de qualquer pergunta.

describe('o cadastro pela conversa (O3)', () => {
  it('as quatro ações estão no catálogo, de botão, com a permissão de cada rota (o fornecedor pede Cadastros, como a rota)', () => {
    expect(ACOES.cadastrar_insumo).toMatchObject({ nivel: 'botao', permissao: 'estoque', crud: 'criar' });
    expect(ACOES.alterar_insumo).toMatchObject({ nivel: 'botao', permissao: 'estoque', crud: 'editar' });
    expect(ACOES.cadastrar_fornecedor).toMatchObject({ nivel: 'botao', permissao: 'cadastros' });
    expect(ACOES.excluir_pedido_compra).toMatchObject({ nivel: 'botao', permissao: 'estoque', crud: 'excluir' });
    expect(['cadastrar_insumo', 'alterar_insumo', 'cadastrar_fornecedor', 'excluir_pedido_compra'].every(ehCadastro)).toBe(true);
    expect(ehCadastro('pausar_canal')).toBe(false);
  });

  it('cadastrar insumo: a unidade da lista do estoque é obrigatória; nome de conversa não vale', () => {
    expect(conferirAcao('cadastrar_insumo', { nome: ' Molho  especial ', medidaDoEstoque: 'quilos', minimo: 5, fornecedor: 'Rucas' })).toEqual({
      parametros: { acao: 'cadastrar_insumo', nome: 'Molho especial', unidade: 'kg', minimo: 5, fornecedor: 'Rucas', nomeComercial: null },
      resumo: 'Cadastrar o insumo "Molho especial" em kg, mínimo de 5, fornecedor Rucas.',
    });
    expect(conferirCadastro('cadastrar_insumo', { nome: 'Molho' })).toHaveProperty('erro');
    expect(conferirCadastro('cadastrar_insumo', { nome: 'Molho', medidaDoEstoque: 'balde mágico' })).toHaveProperty('erro');
    expect(conferirCadastro('cadastrar_insumo', { nome: 'confirmado', medidaDoEstoque: 'kg' })).toHaveProperty('erro');
    expect(conferirCadastro('cadastrar_insumo', { nome: 'Molho', medidaDoEstoque: 'kg', minimo: -1 })).toHaveProperty('erro');
    expect(conferirCadastro('cadastrar_insumo', { nome: 'Molho', medidaDoEstoque: 'kg', minimo: '5' })).toHaveProperty('erro');
  });

  it('alterar insumo: só o que muda; a conversão leva a unidade e a quantidade', () => {
    const r: any = conferirAcao('alterar_insumo', { item: 'oleo', conversaoDe: 'caixas', conversaoQuantas: 20, nomeComercial: 'OLEO SOJA SOYA PET 900ml' });
    expect(r.parametros).toEqual({ acao: 'alterar_insumo', item: 'oleo', novoNome: null, nomeComercial: 'OLEO SOJA SOYA PET 900ml', minimo: null, conversao: { unidade: 'caixa', quantas: 20 }, fornecedor: null });
    expect(conferirCadastro('alterar_insumo', { item: 'oleo' })).toHaveProperty('erro');
    expect(conferirCadastro('alterar_insumo', { item: 'oleo', conversaoDe: 'caixa' })).toHaveProperty('erro');
    expect(conferirCadastro('alterar_insumo', { item: 'oleo', conversaoDe: 'caixa', conversaoQuantas: 0 })).toHaveProperty('erro');
    expect(conferirCadastro('alterar_insumo', { item: 'oleo', novoNome: 'pode registrar' })).toHaveProperty('erro');
  });

  it('cadastrar fornecedor: o CNPJ conferido pelo dígito; o telefone com DDD', () => {
    const r: any = conferirAcao('cadastrar_fornecedor', { nome: 'Rucas', cnpj: '11.222.333/0001-81', foneDoFornecedor: '(21) 98765-4321', contato: 'Marcos' });
    expect(r.parametros).toEqual({ acao: 'cadastrar_fornecedor', nome: 'Rucas', cnpj: '11222333000181', telefone: '21987654321', contato: 'Marcos' });
    // O resumo não repete o telefone.
    expect(r.resumo).not.toContain('98765');
    expect(conferirCadastro('cadastrar_fornecedor', { nome: 'Rucas', cnpj: '11.222.333/0001-82' })).toHaveProperty('erro');
    expect(conferirCadastro('cadastrar_fornecedor', { nome: 'Rucas', foneDoFornecedor: '1234' })).toHaveProperty('erro');
  });

  it('excluir pedido: diz qual', () => {
    expect(conferirCadastro('excluir_pedido_compra', { pedidoDeCompra: 'Lista do Mister · 23/11 06:12' })).toMatchObject({ parametros: { pedido: 'Lista do Mister · 23/11 06:12' } });
    expect(conferirCadastro('excluir_pedido_compra', {})).toHaveProperty('erro');
  });
});
