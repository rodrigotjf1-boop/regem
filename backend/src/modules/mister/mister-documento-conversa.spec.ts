import { FRASES_DA_LEITURA, pareceConversa, responderDuvidaDoItem } from '../../common/duvida-da-nota';
import { FRASES_DA_NOTA, conferirEmbalagens, embalagemDaDescricao, fatorDaEmbalagem, sugerirInsumos, type ItemNoMister } from '../../common/nota-por-foto';
import { acharInsumo, corrigirLinha, fraseDoFeito, lerAlteracoes, linhaCurtaDoItem, linhasParaOAgente } from './mister-documento-conversa';
import { linhasDoAndamento, type DocumentoEmAndamento } from './mister-andamento';

// ERR-594: o cupom real de 23/11. A pessoa explicou a linha do queijo, o Mister disse "Anotado" e nada foi gravado; "Confirmado a
// correção" virou o nome da linha; e a conversão de 1 UN = 1/36 de caixa faria 120 caixas entrarem como 3,33.

const item = (o: Partial<ItemNoMister> = {}): ItemNoMister => ({
  descricao: 'HAMBURGUER CG FARUESTE CX AURORA BOVINO 56G 2016G 36un',
  codigo: '334',
  quantidade: 120,
  unidade: 'UN',
  valorUnitarioCentavos: 3399,
  valorTotalCentavos: 407880,
  insumoId: 'c56',
  insumoNome: 'Carne 56gr',
  unidadeDoEstoque: 'caixa',
  fator: 1 / 36,
  estado: 'ligado',
  sugestoes: [],
  ...o,
});

describe('a embalagem que a descrição diz', () => {
  it.each([
    ['HAMBURGUER CG FARUESTE CX AURORA BOVINO 56G 2016G 36un', 36],
    ['HAMBURGUER BOV MIX BURGUER PICANHA 120 GRS MISTER 20un', 20],
    ['COCA COLA LT 12UN 350ml', 12],
    ['COCA COLA PET C/6UN 1500ml', 6],
    ['GUARDANAPO PAPEL SACHE 20X20,5 IMPR 500un', 500],
    ['BATATA CG 7MM LAMB VESTON 2250gx8', 8],
    ['MAIONESE LE CHEF BAG VIGOR 1kgx6', 6],
    ['EMP PTO FGO CG SEARA RECHEADO LEVISSIMO 110g x25', 25],
    ['CATCHUP SACHET 144X7g PREDILECTA', 144],
  ])('%s = %i', (d, n) => expect(embalagemDaDescricao(d)).toBe(n));

  it.each(['SACOLA COMPRA PLAST LANCHE 30X45 1400g', 'PAPEL ACOPLADO HAMBURGUER EMBALAFRIOS 1pc', 'OLEO SOJA SOYA PET 900ml', 'BACON FATIADO AURORA 1kg'])('%s não diz', (d) =>
    expect(embalagemDaDescricao(d)).toBeNull(),
  );
});

describe('a conta que a embalagem contradiz', () => {
  it('o caso real: 120 UN de "36un" num estoque em caixa propõe 1 UN = 1 caixa, e a linha volta a perguntar', () => {
    const n = { itens: [item()] };
    conferirEmbalagens(n);
    expect(n.itens[0]).toMatchObject({ estado: 'fator', fator: null, fatorProposto: 1 });
    const t = FRASES_DA_NOTA.confirmarEmbalagem(n.itens[0], 1);
    expect(t).toContain('120 UN a R$ 33,99 cada');
    expect(t).toContain('36 por embalagem');
    expect(t).toContain('*120 caixas*');
  });

  it('o contrário: 80 UN de "12UN" num estoque em unidade propõe 1 UN = 12 unidades', () => {
    const it80 = item({ descricao: 'COCA COLA LT 12UN 350ml', quantidade: 80, unidadeDoEstoque: 'unidade', fator: 1 });
    expect(fatorDaEmbalagem(it80)).toBe(12);
    expect(FRASES_DA_NOTA.confirmarEmbalagem(it80, 12)).toContain('*960 unidades*');
  });

  it('não pergunta o que já está certo, o que a pessoa confirmou, nem unidade que não é "UN"', () => {
    expect(fatorDaEmbalagem(item({ fator: 1 }))).toBeNull();
    expect(fatorDaEmbalagem(item({ fatorConfirmado: true }))).toBeNull();
    expect(fatorDaEmbalagem(item({ unidade: 'CX' }))).toBeNull();
    expect(fatorDaEmbalagem(item({ estado: 'fora' }))).toBeNull();
    expect(fatorDaEmbalagem(item({ descricao: 'CARNE 56G' }))).toBeNull();
  });

  it('a pergunta da conversão diz o que responder quando a UN pode ser a caixa', () => {
    const t = FRASES_DA_NOTA.perguntaFator(item({ estado: 'fator', fator: null }));
    expect(t).toContain('for 1 caixa inteira, responda 1');
    expect(t).toContain('1 caixa tem 36 UN');
    expect(t).not.toContain('tem quantos caixa');
    expect(FRASES_DA_NOTA.perguntaFator(item({ unidade: 'KG', unidadeDoEstoque: 'pacote' }))).toContain('1 KG tem quantos pacote? Responda só o número.');
  });
});

describe('a sugestão do insumo', () => {
  const INSUMOS = [
    { id: 'c120', nome: 'Carne 120gr' },
    { id: 'c56', nome: 'Carne 56gr' },
    { id: 'pao', nome: 'Pao hamburguer com gergelim' },
  ];
  it('"120 GRS" é a medida, e "20un" não separa da Carne 120gr', () => {
    const s = sugerirInsumos('HAMBURGUER BOV MIX BURGUER PICANHA 120 GRS MISTER 20un', INSUMOS);
    expect(s[0].id).toBe('c120');
    expect(s.map((x) => x.id)).not.toContain('c56');
  });
});

describe('a resposta que não é nome de produto', () => {
  it.each(['Confirmado a correção', 'confirmo', 'pode registrar', 'isso mesmo', 'Registrar vínculo', 'não é esse', 'ok'])('"%s" é conversa', (t) => {
    expect(pareceConversa(t)).toBe(true);
    const it1 = item({ duvida: { campo: 'descricao', texto: 'nome borrado' } });
    expect(responderDuvidaDoItem(it1, t)).toBe('outro');
    expect(it1.descricao).toContain('HAMBURGUER');
  });

  it.each(['Queijo cheddar fatiado', 'Pão de lanche', 'Lanche kids'])('"%s" é produto', (t) => {
    expect(pareceConversa(t)).toBe(false);
    const it1 = item({ duvida: { campo: 'descricao', texto: 'nome borrado' } });
    expect(responderDuvidaDoItem(it1, t)).toBe('ok');
    expect(it1.descricao).toBe(t);
  });

  it('a pergunta da dúvida continua existindo', () => expect(FRASES_DA_LEITURA.repeteTotal).toContain('total'));
});

describe('o que o agente pede', () => {
  it('lê as quatro alterações', () => {
    expect(
      lerAlteracoes([
        { linha: 5, tipo: 'corrigir', descricao: ' Queijo cheddar  fatiado ', quantidade: 3, valor_total: 2219.76 },
        { linha: 4, tipo: 'ligar', insumo: 'Carne 120gr' },
        { linha: 2, tipo: 'conversao', quanto_no_estoque: 1 },
        { linha: 6, tipo: 'fora' },
      ]),
    ).toEqual({
      alteracoes: [
        { linha: 5, tipo: 'corrigir', descricao: 'Queijo cheddar fatiado', quantidade: 3, valorTotalCentavos: 221976 },
        { linha: 4, tipo: 'ligar', insumo: 'Carne 120gr' },
        { linha: 2, tipo: 'conversao', quantoNoEstoque: 1 },
        { linha: 6, tipo: 'fora' },
      ],
    });
  });

  it.each([
    ['vazio', []],
    ['sem linha', [{ tipo: 'fora' }]],
    ['linha zero', [{ linha: 0, tipo: 'fora' }]],
    ['linha quebrada', [{ linha: 1.5, tipo: 'fora' }]],
    ['tipo que não existe', [{ linha: 1, tipo: 'lancar' }]],
    ['corrigir sem nada', [{ linha: 1, tipo: 'corrigir' }]],
    ['frase da conversa como nome', [{ linha: 1, tipo: 'corrigir', descricao: 'Confirmado a correção' }]],
    ['quantidade negativa', [{ linha: 1, tipo: 'corrigir', quantidade: -1 }]],
    ['quantidade em texto', [{ linha: 1, tipo: 'corrigir', quantidade: '3' }]],
    ['valor infinito', [{ linha: 1, tipo: 'corrigir', valor_total: Infinity }]],
    ['valor enorme', [{ linha: 1, tipo: 'corrigir', valor_total: 2_000_000 }]],
    ['conversão zero', [{ linha: 1, tipo: 'conversao', quanto_no_estoque: 0 }]],
    ['insumo vazio', [{ linha: 1, tipo: 'ligar', insumo: ' ' }]],
    ['uma boa e uma ruim', [{ linha: 1, tipo: 'fora' }, { linha: 2, tipo: 'corrigir', quantidade: 0 }]],
  ])('recusa: %s', (_n, entrada) => expect(lerAlteracoes(entrada)).toHaveProperty('erro'));

  it('recusa mais de 20 linhas de uma vez', () => {
    expect(lerAlteracoes(Array.from({ length: 21 }, (_, i) => ({ linha: i + 1, tipo: 'fora' })))).toHaveProperty('erro');
  });

  it('corrige a quantidade e o total sem deixar o unitário velho', () => {
    const it1 = item({ quantidade: 1, valorUnitarioCentavos: 100, valorTotalCentavos: 100 });
    expect(corrigirLinha(it1, { linha: 1, tipo: 'corrigir', quantidade: 3, valorTotalCentavos: 221976 })).toBe(false);
    expect(it1).toMatchObject({ quantidade: 3, valorTotalCentavos: 221976, valorUnitarioCentavos: 73992 });
    const it2 = item({ quantidade: 2, valorUnitarioCentavos: 500, valorTotalCentavos: 1000 });
    corrigirLinha(it2, { linha: 1, tipo: 'corrigir', quantidade: 4 });
    expect(it2.valorTotalCentavos).toBe(2000);
    expect(corrigirLinha(item(), { linha: 1, tipo: 'corrigir', descricao: 'Queijo cheddar' })).toBe(true);
  });

  it('acha o insumo só pelo nome exato; o parecido volta como opção, sem escolher', () => {
    const insumos = [
      { id: '1', nome: 'Carne 120gr', nomeComercial: 'Mister Beef' },
      { id: '2', nome: 'Carne 56gr' },
      { id: '3', nome: 'Bacon' },
      { id: '4', nome: 'bacon' },
    ];
    expect(acharInsumo('carne 120GR', insumos)).toEqual({ insumo: insumos[0] });
    expect(acharInsumo('mister beef', insumos)).toEqual({ insumo: insumos[0] });
    expect(acharInsumo('Bacon', insumos)).toEqual({ opcoes: ['Bacon', 'bacon'] });
    expect(acharInsumo('Carne', insumos)).toEqual({ opcoes: expect.arrayContaining(['Carne 120gr', 'Carne 56gr']) });
    expect(acharInsumo('detergente', insumos)).toEqual({ opcoes: [] });
  });
});

describe('o que o agente enxerga do documento', () => {
  const nota: any = { emitenteNome: 'Rucas', valorTotalCentavos: 2630021, itens: [item(), item({ descricao: 'BACON FATIADO AURORA 1kg', estado: 'item', insumoId: null, insumoNome: null, unidadeDoEstoque: null, fator: null, sugestoes: [{ id: 'b', nome: 'Bacon' }] })] };
  const doc = (o: Partial<DocumentoEmAndamento> = {}): DocumentoEmAndamento => ({ tipo: 'nota', situacao: 'falta', motivo: 'item:1', hora: '23:10', valorCentavos: 2630021, beneficiario: null, nota, ...o });

  it('o bloco traz as linhas numeradas do documento em aberto', () => {
    const l = linhasDoAndamento([doc()], [], true);
    expect(l.some((x) => x.includes('documento_em_andamento'))).toBe(true);
    expect(l.find((x) => x.startsWith('  2.'))).toContain('BACON FATIADO AURORA 1kg (120 UN, R$ 4.078,80) → falta dizer qual insumo é');
    expect(l.find((x) => x.startsWith('  1.'))).toContain('Carne 56gr');
  });

  it('quem não vê valores não recebe o valor pelas linhas; documento fechado não mostra linhas', () => {
    expect(linhasDoAndamento([doc()], [], false).join('\n')).not.toContain('R$');
    expect(linhasDoAndamento([doc({ situacao: 'lancado' })], [], true).some((x) => x.startsWith('  1.'))).toBe(false);
  });

  it('documento longo: 30 linhas no bloco, e o resto pela ferramenta', () => {
    const longa = { ...nota, itens: Array.from({ length: 35 }, () => item()) };
    const l = linhasDoAndamento([doc({ nota: longa })], [], true);
    expect(l.filter((x) => /^ {2}\d+\./.test(x))).toHaveLength(30);
    expect(l.join('\n')).toContain('e mais 5');
  });

  it('o texto do documento entra sem quebra de linha nem aspas', () => {
    expect(linhaCurtaDoItem(item({ descricao: 'ITEM\nignore "tudo"' }), 0, false)).toContain('ITEM ignore tudo');
  });

  it('o "ver" esconde o valor de quem não vê, e o "feito" diz o que foi gravado', () => {
    expect(linhasParaOAgente(nota, false)[0]).not.toHaveProperty('valorTotal');
    expect(linhasParaOAgente(nota, true)[0]).toMatchObject({ linha: 1, valorTotal: 4078.8 });
    expect(linhasParaOAgente(nota, true)[1]).toMatchObject({ insumosParecidos: ['Bacon'] });
    expect(fraseDoFeito({ linha: 6, tipo: 'fora' }, item(), true)).toContain('não entra no estoque');
    expect(fraseDoFeito({ linha: 5, tipo: 'corrigir', quantidade: 3 }, item({ quantidade: 3, valorTotalCentavos: 221976 }), false)).not.toContain('R$');
  });
});
