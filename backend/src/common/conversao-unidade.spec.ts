import {
  arredondarInformado,
  chaveUnidade,
  conversoesSoltas,
  fatorParaEstoque,
  paraEstoque,
  proporcaoFixa,
  unidadesDoProduto,
  valoresEmEstoque,
} from './conversao-unidade';

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
    expect(fatorParaEstoque('litro', 'kg', bacon)).toBeNull(); // peso não vira volume sozinho
    expect(paraEstoque(3, 'litro', 'kg', bacon)).toEqual({ fator: 1, quantidade: 3 });
    expect(fatorParaEstoque('fatia', 'kg', bacon)).toBeNull();
    expect(fatorParaEstoque('grama', 'fardo', fardo)).toBeNull(); // fardo e unidade não têm peso
  });

  it('conversão sem fator, negativa ou para a mesma unidade é ignorada', () => {
    const ruins = [
      { unidadeDe: 'kg', fator: 0, unidadePara: 'unidade' },
      { unidadeDe: 'kg', fator: -5, unidadePara: 'pacote' },
      { unidadeDe: 'unidade', fator: 1, unidadePara: 'unidade' },
      { unidadeDe: 'kg', fator: 'abc', unidadePara: 'saco' },
    ];
    expect([...valoresEmEstoque('kg', ruins).keys()]).toEqual(['kg', 'grama']); // só a medida fixa
  });

  it('lista as unidades do produto com o nome do cadastro, a do estoque primeiro', () => {
    expect(unidadesDoProduto('kg', bacon)).toEqual([
      { unidade: 'kg', fator: 1 },
      { unidade: 'unidade', fator: 1 / 72 },
      { unidade: 'grama', fator: 0.001 },
    ]);
    expect(unidadesDoProduto('fardo', [])).toEqual([{ unidade: 'fardo', fator: 1 }]);
  });
});

// MEDIDAS FIXAS (pedido do dono, 12/10/2026): quilo e grama, litro e mililitro o sistema converte
// sozinho — ninguém cadastra que 1 kg tem 1000 gramas.
describe('medidas fixas: kg ↔ grama, litro ↔ ml', () => {
  it('produto em kg, sem conversão nenhuma: pode ser usado em grama (2500 grama = 2,5 kg)', () => {
    expect(unidadesDoProduto('kg', [])).toEqual([{ unidade: 'kg', fator: 1 }, { unidade: 'grama', fator: 0.001 }]);
    expect(paraEstoque(2500, 'grama', 'kg', [])).toEqual({ fator: 0.001, quantidade: 2.5 });
    expect(paraEstoque(30, 'grama', 'kg', []).quantidade).toBe(0.03);
  });

  it('produto em grama: 2,5 kg = 2500 grama', () => {
    expect(unidadesDoProduto('grama', [])).toEqual([{ unidade: 'grama', fator: 1 }, { unidade: 'kg', fator: 1000 }]);
    expect(paraEstoque(2.5, 'kg', 'grama', [])).toEqual({ fator: 1000, quantidade: 2500 });
  });

  it('litro e ml, nos dois sentidos', () => {
    expect(unidadesDoProduto('litro', [])).toEqual([{ unidade: 'litro', fator: 1 }, { unidade: 'ml', fator: 0.001 }]);
    expect(paraEstoque(350, 'ml', 'litro', []).quantidade).toBe(0.35);
    expect(unidadesDoProduto('ml', [])).toEqual([{ unidade: 'ml', fator: 1 }, { unidade: 'litro', fator: 1000 }]);
    expect(paraEstoque(2, 'litro', 'ml', []).quantidade).toBe(2000);
  });

  it('o caso que motivou: guardado em caixa, "1 caixa = 6 kg" e "1 porção = 30 grama" → a porção se liga à caixa', () => {
    const molho = [
      { unidadeDe: 'caixa', fator: 6, unidadePara: 'kg' },
      { unidadeDe: 'porção', fator: 30, unidadePara: 'grama' },
    ];
    expect(unidadesDoProduto('caixa', molho).map((u) => u.unidade)).toEqual(['caixa', 'kg', 'grama', 'porção']);
    expect(fatorParaEstoque('porção', 'caixa', molho)).toBeCloseTo(0.005, 15); // 30 g = 0,03 kg = 0,005 caixa
    expect(fatorParaEstoque('grama', 'caixa', molho)).toBeCloseTo(1 / 6000, 15);
    expect(paraEstoque(2, 'porção', 'caixa', molho).quantidade).toBeCloseTo(0.01, 15);
    // a ordem das linhas não importa
    expect(fatorParaEstoque('porção', 'caixa', [...molho].reverse())).toBeCloseTo(0.005, 15);
    expect(conversoesSoltas('caixa', molho)).toEqual([]);
  });

  it('a mesma medida escrita de outro jeito (texto antigo): "g", "l", "quilos", "k"', () => {
    expect(fatorParaEstoque('g', 'kg', [])).toBe(0.001);
    expect(fatorParaEstoque('gramas', 'quilos', [])).toBe(0.001);
    expect(fatorParaEstoque('k', 'grama', [])).toBe(1000);
    expect(fatorParaEstoque('litro', 'l', [])).toBe(1);
    expect(fatorParaEstoque('ml', 'L', [])).toBe(0.001);
    // produto antigo guardado em "l": oferece o ml, sem repetir o litro
    expect(unidadesDoProduto('l', [])).toEqual([{ unidade: 'l', fator: 1 }, { unidade: 'ml', fator: 0.001 }]);
    // conversão escrita com "g": é por esse nome que ela se liga, e "grama" não aparece em dobro
    const antigo = [{ unidadeDe: 'porção', fator: 30, unidadePara: 'g' }];
    expect(unidadesDoProduto('kg', antigo).map((u) => u.unidade)).toEqual(['kg', 'g', 'porção']);
    expect(fatorParaEstoque('porção', 'kg', antigo)).toBeCloseTo(0.03, 15);
    expect(fatorParaEstoque('grama', 'kg', antigo)).toBe(0.001);
  });

  it('a conversão do próprio produto entre duas medidas fixas vale no lugar da fixa (cadastro antigo)', () => {
    const proprio = [{ unidadeDe: 'kg', fator: 900, unidadePara: 'grama' }];
    expect(fatorParaEstoque('grama', 'kg', proprio)).toBeCloseTo(1 / 900, 15);
    expect(unidadesDoProduto('kg', proprio).map((u) => u.unidade)).toEqual(['kg', 'grama']);
    // repetir a medida certa não muda nada
    expect(fatorParaEstoque('grama', 'kg', [{ unidadeDe: 'kg', fator: 1000, unidadePara: 'grama' }])).toBe(0.001);
  });

  it('peso e volume não se ligam sozinhos; ligados pelo cadastro (1 litro = 0,92 kg), cada um traz o seu par', () => {
    expect(fatorParaEstoque('ml', 'kg', [])).toBeNull();
    expect(fatorParaEstoque('grama', 'litro', [])).toBeNull();
    const oleo = [{ unidadeDe: 'litro', fator: 0.92, unidadePara: 'kg' }];
    expect(unidadesDoProduto('litro', oleo).map((u) => u.unidade)).toEqual(['litro', 'kg', 'grama', 'ml']);
    expect(fatorParaEstoque('grama', 'litro', oleo)).toBeCloseTo(1 / 920, 15);
    expect(fatorParaEstoque('ml', 'litro', oleo)).toBe(0.001);
  });

  it('produto que não é de peso nem de volume não ganha unidade nenhuma', () => {
    expect(unidadesDoProduto('unidade', [])).toEqual([{ unidade: 'unidade', fator: 1 }]);
    expect(unidadesDoProduto('caixa', [{ unidadeDe: 'caixa', fator: 12, unidadePara: 'lata' }]).map((u) => u.unidade)).toEqual(['caixa', 'lata']);
  });

  it('conversão solta: a que não chega à unidade do estoque nem pelas medidas fixas', () => {
    const conversoes = [
      { unidadeDe: 'caixa', fator: 6, unidadePara: 'kg' }, // ligada
      { unidadeDe: 'porção', fator: 30, unidadePara: 'grama' }, // ligada pela medida fixa
      { unidadeDe: 'pacote', fator: 10, unidadePara: 'bisnaga' }, // solta: nenhuma das duas existe no produto
      { unidadeDe: 'garrafa', fator: 500, unidadePara: 'ml' }, // solta: o produto não tem volume
      { unidadeDe: 'lata', fator: 0, unidadePara: 'pote' }, // incompleta: não conta
    ];
    expect(conversoesSoltas('caixa', conversoes)).toEqual([2, 3]);
    expect(conversoesSoltas('kg', [])).toEqual([]);
  });

  it('proporção fixa entre duas unidades (para o cadastro recusar a que contradiz)', () => {
    expect(proporcaoFixa('kg', 'grama')).toBe(1000);
    expect(proporcaoFixa('grama', 'kg')).toBe(0.001);
    expect(proporcaoFixa('litro', 'ml')).toBe(1000);
    expect(proporcaoFixa('L', 'litros')).toBe(1);
    expect(proporcaoFixa('kg', 'litro')).toBeNull();
    expect(proporcaoFixa('caixa', 'kg')).toBeNull();
    expect(proporcaoFixa('', null)).toBeNull();
  });
});
