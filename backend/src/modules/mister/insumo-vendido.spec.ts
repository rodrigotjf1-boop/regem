import { acharInsumo, comparacaoComAsSemanas, deOndeSairam, emQuilos, pesoNoNome, seriePorDia, seriePorHora } from './insumo-vendido';

// M3c — o relatório por insumo do Mister (versão 3 do protótipo, conversas 15 e 16; decisão 10): só o que é puro.

const INSUMOS = [
  { id: 'c56', nome: 'Carne 56 g', nomeComercial: null },
  { id: 'c120', nome: 'Carne 120 g', nomeComercial: null },
  { id: 'bac', nome: 'Bacon em tiras' },
  { id: 'pao', nome: 'Pão brioche' },
];

describe('achar o insumo pelo que a pessoa disse', () => {
  it('a medida decide: "carnes de 56g" é a de 56 g, nunca a de 120 g (o plural também)', () => {
    expect(acharInsumo('carnes de 56g', INSUMOS)).toEqual({ tipo: 'achou', id: 'c56', nome: 'Carne 56 g' });
    expect(acharInsumo('hambúrguer 120 g', INSUMOS)).toEqual({ tipo: 'achou', id: 'c120', nome: 'Carne 120 g' });
    expect(acharInsumo('Pão Brioche', INSUMOS)).toEqual({ tipo: 'achou', id: 'pao', nome: 'Pão brioche' });
    expect(acharInsumo('bacon', INSUMOS)).toEqual({ tipo: 'achou', id: 'bac', nome: 'Bacon em tiras' });
  });
  it('"carne" sozinha tem duas: pergunta qual; o que não existe, nada', () => {
    expect(acharInsumo('carne', INSUMOS)).toEqual({ tipo: 'escolher', opcoes: ['Carne 120 g', 'Carne 56 g'] });
    expect(acharInsumo('detergente', INSUMOS)).toEqual({ tipo: 'nenhum' });
    expect(acharInsumo('', INSUMOS)).toEqual({ tipo: 'nenhum' });
  });
});

describe('o total em quilos (decisão 10)', () => {
  it('o peso no nome', () => {
    expect(pesoNoNome('Carne 56 g')).toBe(56);
    expect(pesoNoNome('Queijo 1,5 kg')).toBe(1500);
    expect(pesoNoNome('Bacon em tiras')).toBeNull();
  });
  it('pela conversão do cadastro: a carne contada em unidade com "1 unidade = 56 grama"', () => {
    expect(emQuilos(212, 'unidade', [{ unidadeDe: 'unidade', fator: 56, unidadePara: 'grama' }], 'Carne 56 g')).toEqual({ kg: 11.872, cercaDeUnidades: null });
  });
  it('sem conversão até o quilo: nada (nunca um palpite)', () => {
    expect(emQuilos(212, 'unidade', [], 'Carne 56 g')).toEqual({ kg: null, cercaDeUnidades: null });
  });
  it('o insumo guardado em kg: os quilos, e "cerca de" quantas unidades pelo peso do nome', () => {
    expect(emQuilos(11.872, 'kg', [], 'Carne 56 g')).toEqual({ kg: 11.872, cercaDeUnidades: 212 });
    expect(emQuilos(5, 'kg', [], 'Bacon em tiras')).toEqual({ kg: 5, cercaDeUnidades: null });
    expect(emQuilos(2500, 'grama', [], 'Queijo')).toEqual({ kg: 2.5, cercaDeUnidades: null });
  });
});

describe('as séries do gráfico', () => {
  it('por hora: do primeiro ao último movimento, com as horas vazias em zero', () => {
    expect(seriePorHora([{ hora: 18, quantidade: 12 }, { hora: 20, quantidade: 71 }, { hora: 22, quantidade: 27 }])).toEqual([
      { rotulo: '18h', quantidade: 12 },
      { rotulo: '19h', quantidade: 0 },
      { rotulo: '20h', quantidade: 71 },
      { rotulo: '21h', quantidade: 0 },
      { rotulo: '22h', quantidade: 27 },
    ]);
    expect(seriePorHora([])).toEqual([]);
  });
  it('por dia: todos os dias do período, com o dia da semana, zero onde não vendeu', () => {
    expect(seriePorDia([{ dia: '2026-11-14', quantidade: 171 }], '2026-11-13', '2026-11-16')).toEqual([
      { rotulo: '13/11 sex', dia: '2026-11-13', quantidade: 0 },
      { rotulo: '14/11 sáb', dia: '2026-11-14', quantidade: 171 },
      { rotulo: '15/11 dom', dia: '2026-11-15', quantidade: 0 },
      { rotulo: '16/11 seg', dia: '2026-11-16', quantidade: 0 },
    ]);
  });
});

describe('a comparação e de onde saiu', () => {
  it('a média das semanas que venderam e a diferença em %', () => {
    expect(comparacaoComAsSemanas(212, [180, 175, 0, 184])).toEqual({ media: 179.7, diferencaPct: 18 });
    expect(comparacaoComAsSemanas(10, [0, 0])).toBeNull();
  });
  it('a ficha × quanto vendeu, do que mais usou; o que a ficha não explica fica em "outros"', () => {
    const r = deOndeSairam(220, [
      { produto: 'Kids', vendidos: 28, porUnidade: 1 },
      { produto: 'X-Burger', vendidos: 120, porUnidade: 1 },
      { produto: 'Combo Duplo', vendidos: 32, porUnidade: 2 },
      { produto: 'Coca-Cola', vendidos: 90, porUnidade: 0 },
    ]);
    expect(r.produtos.map((x) => [x.produto, x.quantidade])).toEqual([
      ['X-Burger', 120],
      ['Combo Duplo', 64],
      ['Kids', 28],
    ]);
    expect(r.outros).toBe(8);
  });
  it('a ficha dá mais do que a venda baixou (o "sem carne" do cliente): sem "outros"', () => {
    expect(deOndeSairam(100, [{ produto: 'X-Burger', vendidos: 110, porUnidade: 1 }]).outros).toBeNull();
  });
});
