import { FRASES_DA_NOTA, linhaDoModelo, type NotaNoMister } from '../../common/nota-por-foto';
import { chaveDoApelido, mudancasDoModelo, viraApelido } from './mister-compra-modelos';
import { CONVERSA_PADRAO, conferirConversa } from './mister-conversa-config.service';

// Versão 9, O2: os modelos de compra e os apelidos (puro). O banco, a nota lançada, a tela e a lista em `mister-pg.teste-spec.ts`.

describe('Mister · O2 — o apelido', () => {
  it('a chave é a das palavras da nota: sem acento, minúsculas, a medida num token só', () => {
    expect(chaveDoApelido('Carne 120')).toBe('carne 120');
    expect(chaveDoApelido('  CARNE   120 ')).toBe('carne 120');
    expect(chaveDoApelido('Pão de hambúrguer 80 g')).toBe(chaveDoApelido('pao hamburguer 80g'));
    expect(chaveDoApelido('molho 1,5 kg')).toBe(chaveDoApelido('MOLHO 1.5KG'));
    // Sem letra ou curto demais não vira apelido.
    for (const ruim of ['', '  ', '12', '7', null, undefined]) expect(chaveDoApelido(ruim)).toBeNull();
  });

  it('vira apelido o nome DIFERENTE do cadastro; o igual (ou o nome comercial) já é achado pelas palavras', () => {
    expect(viraApelido('coca lt', { nome: 'Coca cola lata 350ml' })).toBe('coca lt');
    expect(viraApelido('Tomate', { nome: 'tomate' })).toBeNull();
    expect(viraApelido('Mister Beef', { nome: 'Carne 120gr', nomeComercial: 'mister beef' })).toBeNull();
    expect(viraApelido('x'.repeat(81), { nome: 'Carne' })).toBeNull();
  });
});

describe('Mister · O2 — o que mudou desde a última nota', () => {
  const item = (o: Record<string, unknown>) => ({ insumoNome: 'Carne 56gr', descricao: 'HAMBURGUER 56G', quantidade: 120, unidade: 'UN', valorUnitarioCentavos: 3399, ...o }) as any;

  it('a quantidade e o preço unitário, pelo nome do insumo; o mesmo valor e o centavo arredondado não contam', () => {
    expect(
      mudancasDoModelo([
        item({ quantidade: 100, ultima: { ultimaQuantidade: 120, ultimoPrecoCentavos: 3399 } }),
        item({ insumoNome: 'Coca lata', quantidade: 10, valorUnitarioCentavos: 3990, ultima: { ultimaQuantidade: 10, ultimoPrecoCentavos: 3828 } }),
        item({ insumoNome: 'Batata', quantidade: 35, valorUnitarioCentavos: 20792, ultima: { ultimaQuantidade: 35, ultimoPrecoCentavos: 20792.4 } }),
        item({ insumoNome: null, descricao: 'DETERGENTE YPE 500ML', ultima: null }),
        item({ insumoNome: 'Sem última vez', ultima: { ultimaQuantidade: null, ultimoPrecoCentavos: null } }),
      ]),
    ).toEqual(['Carne 56gr de 120 para 100 UN', 'Coca lata de R$ 38,28 para R$ 39,90']);
  });

  it('a linha do resumo: quantos conhecia, o que mudou (até 4, depois "e mais") e nada sem modelo', () => {
    expect(linhaDoModelo(null)).toBe('');
    expect(linhaDoModelo({ conhecidos: 0, mudancas: ['x'] })).toBe('');
    expect(linhaDoModelo({ conhecidos: 1, mudancas: [] })).toBe('📚 1 produto já conheço pelo modelo deste fornecedor. Nada mudou na quantidade nem no preço.');
    expect(linhaDoModelo({ conhecidos: 16, mudancas: ['a', 'b', 'c', 'd', 'e', 'f'] })).toBe('📚 16 produtos já conheço pelo modelo deste fornecedor. Mudou: a; b; c; d e mais 2.');
  });

  it('o resumo da nota leva a linha logo abaixo do cabeçalho; sem modelo, o resumo de sempre', () => {
    const nota: NotaNoMister = {
      chave: null,
      numero: '1',
      emitenteNome: 'Rucas',
      emitenteCnpj: '12345678000195',
      valorTotalCentavos: 1000,
      duplicatas: [],
      itens: [{ descricao: 'BACON', codigo: null, quantidade: 1, unidade: 'KG', valorUnitarioCentavos: 1000, valorTotalCentavos: 1000, insumoId: 'x', insumoNome: 'Bacon', unidadeDoEstoque: 'kg', fator: 1, estado: 'ligado', sugestoes: [] }],
    };
    const sem = FRASES_DA_NOTA.resumo(nota);
    expect(sem).not.toContain('📚');
    const com = FRASES_DA_NOTA.resumo({ ...nota, modelo: { conhecidos: 1, mudancas: ['Bacon de R$ 9,00 para R$ 10,00'] } });
    expect(com.split('\n')[1]).toBe('📚 1 produto já conheço pelo modelo deste fornecedor. Mudou: Bacon de R$ 9,00 para R$ 10,00.');
    expect(com.replace(/\n📚[^\n]*/, '')).toBe(sem);
  });
});

describe('Mister · O2 — o ajuste "Aprender o modelo de cada fornecedor"', () => {
  it('nasce desligado e só aceita sim ou não de verdade', () => {
    expect(CONVERSA_PADRAO.aprenderModelos).toBe(false);
    expect(conferirConversa({ aprenderModelos: true })).toEqual({ aprenderModelos: true });
    expect(conferirConversa({ aprenderModelos: 'sim' })).toHaveProperty('erro');
  });
});
