import { arredondarInformado, chaveUnidade, fatorParaEstoque, paraEstoque, unidadesDoProduto, valoresEmEstoque } from './conversao-unidade';

// Conversão de unidade do produto do estoque: a quantidade informada numa unidade convertida
// (fatia, unidade do fardo) vira quantidade na unidade do estoque (kg, fardo) — é nela que a
// venda baixa e o custo é calculado.
describe('conversão de unidade do produto', () => {
  const bacon = [{ unidadeDe: 'kg', fator: 72, unidadePara: 'unidade' }]; // 1 kg = 72 fatias
  const fardo = [{ unidadeDe: 'fardo', fator: 12, unidadePara: 'unidade' }];

  it('a própria unidade do estoque (ou nenhuma) vale 1', () => {
    expect(fatorParaEstoque('kg', 'kg', bacon)).toBe(1);
    expect(fatorParaEstoque('', 'kg', bacon)).toBe(1);
    expect(fatorParaEstoque(null, 'kg', [])).toBe(1);
    expect(fatorParaEstoque('KG ', 'kg', [])).toBe(1);
  });

  it('bacon em kg, 1 kg = 72 fatias: 2 fatias = 0,0277… kg', () => {
    expect(fatorParaEstoque('unidade', 'kg', bacon)).toBeCloseTo(1 / 72, 12);
    const r = paraEstoque(2, 'unidade', 'kg', bacon);
    expect(r.quantidade).toBeCloseTo(0.0277777777778, 12);
    expect(arredondarInformado(r.quantidade / r.fator)).toBe(2); // volta exata para mostrar na tela
  });

  it('fardo de 12: custo de R$ 36 o fardo = R$ 3 a unidade', () => {
    const f = fatorParaEstoque('unidade', 'fardo', fardo)!;
    expect(arredondarInformado(36 * f)).toBe(3);
    expect(paraEstoque(1, 'unidade', 'fardo', fardo).quantidade).toBeCloseTo(1 / 12, 12);
    expect(paraEstoque(12, 'unidade', 'fardo', fardo).quantidade).toBe(1);
  });

  it('sentido contrário: produto em unidade, conversão "1 fardo = 12 unidade" → 1 fardo = 12 de estoque', () => {
    expect(fatorParaEstoque('fardo', 'unidade', fardo)).toBe(12);
  });

  it('em cadeia: 1 caixa = 10 pacotes, 1 pacote = 12 unidades → 1 unidade = 1/120 caixa', () => {
    const cadeia = [
      { unidadeDe: 'caixa', fator: 10, unidadePara: 'pacotes' },
      { unidadeDe: 'pacotes', fator: 12, unidadePara: 'unidade' },
    ];
    expect(fatorParaEstoque('pacote', 'caixa', cadeia)).toBeCloseTo(0.1, 12);
    expect(fatorParaEstoque('unidade', 'caixa', cadeia)).toBeCloseTo(1 / 120, 12);
    // a ordem das linhas não importa
    expect(fatorParaEstoque('unidade', 'caixa', [...cadeia].reverse())).toBeCloseTo(1 / 120, 12);
  });

  it('"pacotes" e "pacote", "Unidades" e "unidade" são a mesma unidade; acento e caixa não contam', () => {
    expect(chaveUnidade('Pacotes')).toBe(chaveUnidade('pacote'));
    expect(chaveUnidade(' Unidades ')).toBe('unidade');
    expect(chaveUnidade('Galão')).toBe('galao');
    expect(chaveUnidade('L')).toBe('l');
    expect(fatorParaEstoque('unidades', 'pacote', [{ unidadeDe: 'pacotes', fator: 6, unidadePara: 'unidade' }])).toBeCloseTo(1 / 6, 12);
  });

  it('unidade que o produto não tem → null (quem chama mantém a quantidade como está)', () => {
    expect(fatorParaEstoque('litro', 'kg', bacon)).toBeNull();
    expect(paraEstoque(3, 'litro', 'kg', bacon)).toEqual({ fator: 1, quantidade: 3 });
  });

  it('conversão sem fator, negativa ou para a mesma unidade é ignorada', () => {
    const ruins = [
      { unidadeDe: 'kg', fator: 0, unidadePara: 'unidade' },
      { unidadeDe: 'kg', fator: -5, unidadePara: 'pacote' },
      { unidadeDe: 'unidade', fator: 1, unidadePara: 'unidade' },
      { unidadeDe: 'kg', fator: 'abc', unidadePara: 'saco' },
    ];
    expect([...valoresEmEstoque('kg', ruins).keys()]).toEqual(['kg']);
  });

  it('lista as unidades do produto com o nome do cadastro, a do estoque primeiro', () => {
    expect(unidadesDoProduto('kg', bacon)).toEqual([
      { unidade: 'kg', fator: 1 },
      { unidade: 'unidade', fator: 1 / 72 },
    ]);
    expect(unidadesDoProduto('fardo', [])).toEqual([{ unidade: 'fardo', fator: 1 }]);
  });
});
