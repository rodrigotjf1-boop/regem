import {
  FRASES_DA_NOTA,
  cadastroDaEmbalagem,
  conferirEmbalagens,
  conteudosDaEmbalagem,
  ehFracaoDeEmbalagem,
  propostaDaEmbalagem,
  razaoDoPedido,
  repeteOConteudo,
  type ItemNoMister,
  type NotaNoMister,
  type PedidoDaNota,
} from './nota-por-foto';

// ERR-628 (a nota da Rucas, 27/11/2026): o fornecedor imprime "UN" para a embalagem fechada, e a conversão do cadastro (o que vem
// DENTRO da caixa) fazia cada UN valer uma fração dela — 25 caixas de Guaravita entravam como 1,04; 40 pacotes de blend, 6,67.
// As linhas abaixo são as da nota real (a descrição, a quantidade e a unidade do estoque).

const linha = (o: Partial<ItemNoMister>): ItemNoMister => ({
  descricao: 'X',
  codigo: null,
  quantidade: 1,
  unidade: 'UN',
  valorUnitarioCentavos: null,
  valorTotalCentavos: null,
  insumoId: 'i-1',
  insumoNome: 'Insumo',
  unidadeDoEstoque: 'caixa',
  fator: 1,
  estado: 'ligado',
  sugestoes: [],
  ...o,
});

const pedido = (itens: Array<{ itemId: string; quantidade: number }>): PedidoDaNota => ({
  listaId: 'l-1',
  nome: 'Lista do Mister · 25/11',
  fornecedor: 'Rucas',
  criado: '25/11',
  itens: itens.length,
  batem: itens.length,
  resposta: 'receber',
  itensDoPedido: itens.map((x, k) => ({ compraItemId: `c-${k}`, itemId: x.itemId, nome: x.itemId, quantidade: x.quantidade })),
});

describe('a fração de embalagem vira dúvida com a conta proposta (ERR-628)', () => {
  it('Guaravita "CX 24", estoque em caixa, 1 UN = 1/24 caixa: volta a perguntar, propondo 1 caixa por UN', () => {
    const it = linha({ descricao: 'GUARAVITA CX 24 290ml', quantidade: 25, fator: 1 / 24, pelaIa: true });
    conferirEmbalagens({ itens: [it] });
    expect(it).toMatchObject({ estado: 'fator', fator: null, fatorProposto: 1 });
  });

  it('blend "900G 1pc", estoque em pacote, 1 UN = 1/6 pacote: propõe 1 pacote por UN', () => {
    const it = linha({ descricao: 'BLEND DISCADO 150G - 900G 1pc', quantidade: 40, unidadeDoEstoque: 'pacote', fator: 1 / 6 });
    conferirEmbalagens({ itens: [it] });
    expect(it).toMatchObject({ estado: 'fator', fatorProposto: 1 });
  });

  it('queijo "2270gx8", estoque em peça: sem o pedido não há prova (a pessoa diz); com o pedido de 24 peças, 8 por UN', () => {
    const sem = linha({ descricao: 'QUEIJO SCHREIBER EMB CHEDDAR 2270gx8', quantidade: 3, unidadeDoEstoque: 'peça', fator: 1 / 184 });
    conferirEmbalagens({ itens: [sem] });
    expect(sem).toMatchObject({ estado: 'fator', fatorProposto: null });

    const com = linha({ descricao: 'QUEIJO SCHREIBER EMB CHEDDAR 2270gx8', quantidade: 3, unidadeDoEstoque: 'peça', fator: 1 / 184 });
    conferirEmbalagens({ itens: [com], pedido: pedido([{ itemId: 'i-1', quantidade: 24 }]) });
    expect(com).toMatchObject({ estado: 'fator', fatorProposto: 8 });
  });

  it('hambúrguer de frango "900gx4", estoque em saco (1 UN = 0,1 saco): o pedido de 20 sacos para 5 UN dá 4 por UN', () => {
    const it = linha({ descricao: 'HAMBURGUER DE FRANGO EMP CONG PT SADIA 900gx4', quantidade: 5, unidadeDoEstoque: 'saco', fator: 0.1 });
    conferirEmbalagens({ itens: [it], pedido: pedido([{ itemId: 'i-1', quantidade: 20 }]) });
    expect(it).toMatchObject({ estado: 'fator', fatorProposto: 4 });
  });

  it('guardanapo "500un", estoque em caixa (1 UN = 1/300): sem pedido, sem proposta; o pedido de 5 caixas para 5 UN dá 1', () => {
    const sem = linha({ descricao: 'GUARDANAPO PAPEL SACHE 28X20,5 IMPR 500un', quantidade: 5, fator: 1 / 300 });
    conferirEmbalagens({ itens: [sem] });
    expect(sem.fatorProposto).toBeNull();
    const com = linha({ descricao: 'GUARDANAPO PAPEL SACHE 28X20,5 IMPR 500un', quantidade: 5, fator: 1 / 300 });
    conferirEmbalagens({ itens: [com], pedido: pedido([{ itemId: 'i-1', quantidade: 5 }]) });
    expect(com.fatorProposto).toBe(1);
  });

  it('a descrição que chama a embalagem pelo nome do estoque ("PCT 100un" num estoque em pacote) propõe 1', () => {
    const it = linha({ descricao: 'EMB DESC ISOPOR HAMBURGUEIRA H1 PCT BRANCO 100un', quantidade: 8, unidadeDoEstoque: 'pacote', fator: 1 / 50 });
    conferirEmbalagens({ itens: [it] });
    expect(it).toMatchObject({ estado: 'fator', fatorProposto: 1 });
  });

  it('o pedido que não bate com 1 nem com a embalagem (veio faltando) não vira prova', () => {
    const it = linha({ descricao: 'QUEIJO SCHREIBER EMB CHEDDAR 2270gx8', quantidade: 3, unidadeDoEstoque: 'peça', fator: 1 / 184 });
    conferirEmbalagens({ itens: [it], pedido: pedido([{ itemId: 'i-1', quantidade: 30 }]) });
    expect(it.fatorProposto).toBeNull();
  });

  it('não mexe no que está certo: a conta confirmada pela pessoa, a unidade solta, o peso e a conta inteira', () => {
    const confirmada = linha({ descricao: 'COCA LATA 350ML', quantidade: 6, unidadeDoEstoque: 'fardo', fator: 1 / 12, fatorConfirmado: true });
    const solta = linha({ descricao: 'COCA COLA ZERO LT 12UN 350ml', quantidade: 30, unidadeDoEstoque: 'unidade', fator: 12 });
    const peso = linha({ descricao: 'BACON FATIADO 500g', quantidade: 4, unidadeDoEstoque: 'kg', fator: 0.5 });
    const inteira = linha({ descricao: 'CATCHUP SACHET 144X7g PREDILECTA', quantidade: 40, fator: 1 });
    conferirEmbalagens({ itens: [confirmada, solta, peso, inteira] });
    expect([confirmada, solta, peso, inteira].map((x) => [x.estado, x.fator])).toEqual([
      ['ligado', 1 / 12],
      ['ligado', 12],
      ['ligado', 0.5],
      ['ligado', 1],
    ]);
  });

  it('a regra "36un" de antes continua: 1 UN = 1/36 caixa com a descrição "36un" propõe 1 caixa', () => {
    const it = linha({ descricao: 'HAMBURGUER CG FAROESTE CX AURORA BOVINO 56G 2016G 36un', quantidade: 100, fator: 1 / 36 });
    conferirEmbalagens({ itens: [it] });
    expect(it).toMatchObject({ estado: 'fator', fatorProposto: 1 });
  });

  it('a linha que espera a conta sem conversão no cadastro (UN → saco) ganha a proposta, e o pedido decide', () => {
    const it = linha({ descricao: 'BATATA PALHA', quantidade: 10, unidadeDoEstoque: 'saco', fator: null, estado: 'fator' });
    conferirEmbalagens({ itens: [it], pedido: pedido([{ itemId: 'i-1', quantidade: 10 }]) });
    expect(it.fatorProposto).toBe(1);
  });

  it('a linha com a proposta da IA ainda sem insumo ganha a conta da proposta (o pedido da linha, não da nota inteira)', () => {
    const it = linha({
      descricao: 'QUEIJO SCHREIBER EMB CHEDDAR 2270gx8',
      quantidade: 3,
      estado: 'item',
      insumoId: null,
      insumoNome: null,
      unidadeDoEstoque: null,
      fator: null,
      propostaDaIa: true,
      sugestoes: [{ id: 'queijo', nome: 'Fatia de queijo cheddar', unidade: 'peça' }],
    });
    conferirEmbalagens({ itens: [it], pedido: pedido([{ itemId: 'queijo', quantidade: 24 }]) });
    expect(it).toMatchObject({ estado: 'item', fatorProposto: 8 });
  });
});

describe('a conta que repete o conteúdo da embalagem (ERR-628)', () => {
  const caixaDe24 = [{ unidadeDe: 'caixa', fator: 24, unidadePara: 'unidade' }];

  it('o cadastro diz o que vem dentro: 1 caixa = 24 unidade', () => {
    expect(conteudosDaEmbalagem('caixa', caixaDe24)).toEqual([24]);
    expect(cadastroDaEmbalagem('caixa', caixaDe24)).toEqual(['1 caixa = 24 unidade']);
    expect(cadastroDaEmbalagem('kg', [])).toEqual([]);
    expect(cadastroDaEmbalagem('caixa', [{ unidadeDe: 'caixa', fator: 6, unidadePara: 'kg' }])).toContain('1 caixa = 6 kg');
  });

  it('"1 UN = 24 caixas" com 1 caixa = 24 unidade é o conteúdo, não a quantidade; 8 peças com 184 fatias por peça, não', () => {
    expect(repeteOConteudo({ unidade: 'UN' }, 'caixa', 24, conteudosDaEmbalagem('caixa', caixaDe24))).toBe(true);
    expect(repeteOConteudo({ unidade: 'UN' }, 'caixa', 1, conteudosDaEmbalagem('caixa', caixaDe24))).toBe(false);
    expect(repeteOConteudo({ unidade: 'UN' }, 'peça', 8, conteudosDaEmbalagem('peça', [{ unidadeDe: 'peça', fator: 184, unidadePara: 'unidade' }]))).toBe(false);
    // O estoque em unidade solta: "12" latas por UN é a conta de verdade.
    expect(repeteOConteudo({ unidade: 'UN' }, 'unidade', 12, [12])).toBe(false);
  });

  it('a fração de embalagem só vale para UN num estoque em embalagem', () => {
    expect(ehFracaoDeEmbalagem({ unidade: 'UN' }, 'caixa', 1 / 24)).toBe(true);
    expect(ehFracaoDeEmbalagem({ unidade: 'KG' }, 'caixa', 0.1)).toBe(false);
    expect(ehFracaoDeEmbalagem({ unidade: 'UN' }, 'kg', 0.5)).toBe(false);
    expect(ehFracaoDeEmbalagem({ unidade: 'UN' }, 'unidade', 0.5)).toBe(false);
    expect(ehFracaoDeEmbalagem({ unidade: 'UN' }, 'caixa', 1)).toBe(false);
  });

  it('a prova do pedido: a quantidade pedida ÷ a da nota no mesmo insumo; "Não é deste pedido" não conta', () => {
    const n: Pick<NotaNoMister, 'itens' | 'pedido'> = { itens: [linha({ quantidade: 3, insumoId: 'q' })], pedido: pedido([{ itemId: 'q', quantidade: 24 }]) };
    expect(razaoDoPedido(n, 'q')).toBe(8);
    expect(razaoDoPedido({ ...n, pedido: { ...n.pedido!, resposta: 'nao' } }, 'q')).toBeNull();
    expect(razaoDoPedido(n, 'outro')).toBeNull();
    expect(propostaDaEmbalagem({ descricao: 'X 2270gx8' }, 'peça', 8)).toBe(8);
    expect(propostaDaEmbalagem({ descricao: 'X 2270gx8' }, 'peça', 7.5)).toBeNull();
  });
});

describe('as dúvidas juntas mostram a conta junto da proposta da IA (ERR-628)', () => {
  it('"é o Guaravita (cada UN = 1 caixa: entram 25 caixas)?" — o "Aceitar as sugestões" vale para as duas', () => {
    const nota = {
      chave: null,
      numero: null,
      emitenteNome: 'RUCAS',
      emitenteCnpj: null,
      valorTotalCentavos: 58_725,
      duplicatas: [],
      itens: [
        linha({
          descricao: 'GUARAVITA CX 24 290ml',
          quantidade: 25,
          estado: 'item',
          insumoId: null,
          insumoNome: null,
          unidadeDoEstoque: null,
          fator: null,
          propostaDaIa: true,
          fatorProposto: 1,
          sugestoes: [{ id: 'g', nome: 'Guaravita copo 290ml', unidade: 'caixa' }],
        }),
      ],
    } as NotaNoMister;
    expect(FRASES_DA_NOTA.pendenciasJuntas(nota)).toContain('é o *Guaravita copo 290ml* (cada UN = 1 caixa: entram 25 caixas)?');
  });
});
