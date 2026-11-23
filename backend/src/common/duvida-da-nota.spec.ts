import {
  FRASES_DA_LEITURA,
  botaoLancarAssim,
  ehMotivoDaLeitura,
  lerItemDigitado,
  lerLancarAssim,
  numeroDaResposta,
  pendenciaDaLeitura,
  podePerguntar,
  responderDuvidaDoItem,
} from './duvida-da-nota';
import { conferirNota, instrucoesDaNota, lerLeituraDaNota, type ItemNoMister, type LeituraDaNota, type NotaNoMister } from './nota-por-foto';

// A dúvida na nota e no cupom (L2b): o Mister guarda o que leu, pergunta só o que falta, e o código nunca escolhe pela pessoa.

const ID = '11111111-2222-4333-8444-555555555555';
const item = (o: Partial<ItemNoMister> = {}): ItemNoMister => ({
  descricao: 'Feijão 1 kg',
  codigo: null,
  quantidade: 1,
  unidade: 'UN',
  valorUnitarioCentavos: 1000,
  valorTotalCentavos: 1000,
  insumoId: null,
  insumoNome: null,
  unidadeDoEstoque: null,
  fator: null,
  estado: 'item',
  sugestoes: [],
  ...o,
});
const nota = (o: Partial<NotaNoMister> = {}): NotaNoMister => ({
  chave: null,
  numero: '1',
  emitenteNome: 'Mercado',
  emitenteCnpj: null,
  valorTotalCentavos: 1000,
  duplicatas: [],
  itens: [item()],
  ...o,
});

describe('a leitura com dúvida', () => {
  it('a linha em dúvida chega, até sem a quantidade', () => {
    const l = lerLeituraDaNota(
      JSON.stringify({
        valorTotal: '60,00',
        itens: [
          { descricao: 'Arroz', quantidade: '2', valorUnitario: '10,00', valorTotal: '20,00', duvida: { campo: 'quantidade', texto: '2 ou 7' } },
          { descricao: 'Feijão', quantidade: null, duvida: { campo: 'quantidade', texto: 'não deu para ler' } },
          { descricao: 'Sal', quantidade: null },
          { descricao: 'Óleo', quantidade: '1', duvida: { campo: 'outro', texto: 'x' } },
        ],
      }),
    )!;
    expect(l.itens.map((x) => x.descricao)).toEqual(['Arroz', 'Feijão', 'Óleo']);
    expect(l.itens[0].duvida).toEqual({ campo: 'quantidade', texto: '2 ou 7' });
    expect(l.itens[2].duvida).toBeUndefined();
  });

  it('as instruções mandam não chutar', () => {
    expect(instrucoesDaNota()).toContain('Nunca chute');
    expect(instrucoesDaNota()).toContain('"duvida"');
  });

  const base: LeituraDaNota = {
    chave: null,
    emitenteNome: 'M',
    emitenteCnpj: null,
    numero: '1',
    valorTotalCentavos: 5000,
    duplicatas: [],
    itens: [{ descricao: 'A', codigo: null, quantidade: 1, unidade: 'UN', valorUnitarioCentavos: 1000, valorTotalCentavos: 1000 }],
    legivel: true,
    especie: 'cupom',
    dataEmissao: null,
    formaPagamento: null,
    descontoCentavos: null,
  };

  it('com linha em dúvida, a foto não é recusada; sem dúvida, os problemas seguem', () => {
    const comDuvida = { ...base, legivel: false, itens: [{ ...base.itens[0], duvida: { campo: 'quantidade' as const, texto: '2 ou 7' } }] };
    expect(conferirNota(comDuvida)).toEqual([]);
    expect(conferirNota(base)).toEqual(['itens_nao_somam']);
    expect(conferirNota({ ...base, legivel: false })).toContain('ilegivel');
  });

  it('só soma e total viram pergunta; chave errada e ilegível pedem outra foto', () => {
    expect(podePerguntar([])).toBe(true);
    expect(podePerguntar(['itens_nao_somam'])).toBe(true);
    expect(podePerguntar(['sem_total', 'itens_nao_somam'])).toBe(true);
    expect(podePerguntar(['ilegivel'])).toBe(false);
    expect(podePerguntar(['itens_nao_somam', 'chave_de_outro_emitente'])).toBe(false);
    expect(podePerguntar(['sem_itens'])).toBe(false);
  });
});

describe('o que falta perguntar, na ordem', () => {
  it('a linha, depois o total, depois a soma', () => {
    const duvida = { campo: 'quantidade' as const, texto: '2 ou 7' };
    expect(pendenciaDaLeitura(nota({ valorTotalCentavos: 0, itens: [item(), item({ duvida })] }))).toBe('duvida:1');
    expect(pendenciaDaLeitura(nota({ valorTotalCentavos: 0 }))).toBe('total');
    expect(pendenciaDaLeitura(nota({ valorTotalCentavos: 9000 }))).toBe('soma');
    expect(pendenciaDaLeitura(nota())).toBeNull();
  });

  it('a soma aceita a tolerância e o "Lançar assim"', () => {
    expect(pendenciaDaLeitura(nota({ valorTotalCentavos: 1090 }))).toBeNull();
    expect(pendenciaDaLeitura(nota({ valorTotalCentavos: 9000, semSomar: true }))).toBeNull();
  });

  it('reconhece só os motivos da leitura', () => {
    for (const m of ['duvida:0', 'duvida:12', 'total', 'soma']) expect(ehMotivoDaLeitura(m)).toBe(true);
    for (const m of ['fator:0', 'item:1', 'como_lancar', 'duvida:x', null]) expect(ehMotivoDaLeitura(m)).toBe(false);
  });
});

describe('a resposta da pessoa', () => {
  it.each([
    ['2', 2],
    ['são 2', 2],
    ['7 unidades', 7],
    ['foram 2,5', 2.5],
    ['R$ 1.284,90', 1284.9],
  ])('"%s" = %d', (t, n) => expect(numeroDaResposta(t)).toBe(n));

  it('pergunta, frase longa e nenhum número não são resposta', () => {
    for (const t of ['quanto vendi em 2025?', 'me manda o relatório completo de 2025', 'sim', '', 'x'.repeat(80)]) expect(numeroDaResposta(t)).toBeNull();
  });

  it('dois números diferentes pedem de novo; o mesmo repetido vale', () => {
    expect(numeroDaResposta('2 ou 7')).toBe('varios');
    expect(numeroDaResposta('2, são 2')).toBe(2);
  });

  it('a quantidade refaz o total da linha pelo valor unitário', () => {
    const it = item({ quantidade: 2, valorUnitarioCentavos: 2490, valorTotalCentavos: 4980, duvida: { campo: 'quantidade', texto: '2 ou 7' } });
    expect(responderDuvidaDoItem(it, 'são 7')).toBe('ok');
    expect(it).toMatchObject({ quantidade: 7, valorTotalCentavos: 17430, duvida: null });
  });

  it('o valor troca o total da linha', () => {
    const it = item({ duvida: { campo: 'valor', texto: '24,90 ou 29,90' } });
    expect(responderDuvidaDoItem(it, '29,90')).toBe('ok');
    expect(it).toMatchObject({ valorTotalCentavos: 2990, duvida: null });
  });

  it('o nome troca a descrição', () => {
    const it = item({ descricao: 'Tomat?', duvida: { campo: 'descricao', texto: 'tomate ou batata' } });
    expect(responderDuvidaDoItem(it, 'batata')).toBe('ok');
    expect(it).toMatchObject({ descricao: 'batata', duvida: null });
  });

  it('o que não é resposta não mexe na linha', () => {
    const q = item({ quantidade: 2, duvida: { campo: 'quantidade', texto: '2 ou 7' } });
    expect(responderDuvidaDoItem(q, 'quanto vendi hoje?')).toBe('outro');
    expect(responderDuvidaDoItem(q, '2 ou 7')).toBe('repete');
    expect(q).toMatchObject({ quantidade: 2, duvida: { texto: '2 ou 7' } });
    const d = item({ duvida: { campo: 'descricao', texto: 'a ou b' } });
    expect(responderDuvidaDoItem(d, 'qual foi a venda de ontem?')).toBe('outro');
    expect(responderDuvidaDoItem(d, 'me manda agora o resumo completo do dia de hoje')).toBe('outro');
    expect(responderDuvidaDoItem(item(), '2')).toBe('outro');
  });

  it.each([
    ['2 cx tomate 60,00', { quantidade: 2, unidade: 'CX', descricao: 'tomate', valorTotalCentavos: 6000 }],
    ['1 arroz branco 5 kg a 24,90', { quantidade: 1, unidade: null, descricao: 'arroz branco 5 kg', valorTotalCentavos: 2490 }],
    ['3 pct bacon R$ 1.200,50', { quantidade: 3, unidade: 'PCT', descricao: 'bacon', valorTotalCentavos: 120050 }],
    ['1,5 kg queijo 45.90', { quantidade: 1.5, unidade: 'KG', descricao: 'queijo', valorTotalCentavos: 4590 }],
  ])('o item digitado: %s', (t, esperado) => expect(lerItemDigitado(t)).toMatchObject(esperado));

  it('frase comum não vira item', () => {
    for (const t of ['faltou o tomate', 'quanto vendi hoje?', '2 caixas de tomate', 'lança assim mesmo', '']) expect(lerItemDigitado(t)).toBeNull();
  });
});

describe('o que o Mister diz', () => {
  it('a linha em dúvida mostra a conta de cada opção, sem escolher', () => {
    const n = nota({
      valorTotalCentavos: 64230,
      itens: [
        item({ descricao: 'Outros', quantidade: 1, valorUnitarioCentavos: 59250, valorTotalCentavos: 59250 }),
        item({ descricao: 'Arroz T1 5 kg', quantidade: 2, valorUnitarioCentavos: 2490, valorTotalCentavos: 4980, duvida: { campo: 'quantidade', texto: '2 ou 7' } }),
      ],
    });
    const t = FRASES_DA_LEITURA.duvida(n, 1);
    expect(t).toContain('só a linha 2 ficou em dúvida');
    expect(t).toContain('*Arroz T1 5 kg*, quantidade *2 ou 7*');
    expect(t).toContain('Com 2, a soma fecha com o total de R$ 642,30.');
    expect(t).toContain('Com 7, daria R$ 766,80.');
    expect(t).toContain('mande outra foto');
  });

  it('várias dúvidas: uma por vez, sem conta enquanto outra linha está aberta', () => {
    const d = { campo: 'quantidade' as const, texto: '2 ou 7' };
    const t = FRASES_DA_LEITURA.duvida(nota({ itens: [item({ duvida: d }), item({ duvida: d })] }), 0);
    expect(t).toContain('2 ficaram em dúvida');
    expect(t).not.toContain('Com 2');
  });

  it('a soma diz quanto falta ou sobra e as três saídas', () => {
    const falta = FRASES_DA_LEITURA.soma(nota({ valorTotalCentavos: 9000 }));
    expect(falta).toContain('Faltam R$ 80,00');
    expect(falta).toContain('outra foto');
    expect(falta).toContain('2 cx tomate 60,00');
    expect(falta).toContain('"Lançar assim"');
    expect(FRASES_DA_LEITURA.soma(nota({ valorTotalCentavos: 500 }))).toContain('Sobram R$ 5,00');
  });

  it('o total pede o valor', () => {
    expect(FRASES_DA_LEITURA.total(nota({ valorTotalCentavos: 0, especie: 'cupom' }))).toContain('não consegui ler o total do cupom');
  });

  it('o botão cabe no limite da Meta e se lê de volta; o torto não', () => {
    const b = botaoLancarAssim(ID);
    expect(b.titulo.length).toBeLessThanOrEqual(20);
    expect(b.id.length).toBeLessThanOrEqual(256);
    expect(lerLancarAssim(b.id)).toBe(ID);
    expect(lerLancarAssim('doc:ns:123')).toBeNull();
    expect(lerLancarAssim(`doc:cl:${ID}:d`)).toBeNull();
  });
});
