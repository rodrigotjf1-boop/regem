import {
  conferirNumeros,
  ehNumeroDoNegocio,
  lerConferencia,
  numerosDoTexto,
  numerosParaConferir,
  numerosSemOrigem,
  origemDe,
  pareceDadoPessoalNaImagem,
  textoDaImagemConferida,
  textoDaImagemErrada,
} from './mister-imagem-numeros';

// Versão 10, C10a — o teste da imagem: os números da imagem do DMS Graph (puro). O caminho inteiro (a proposta, o "Gerar", a
// conferência, a auditoria e a chave nova na tentativa seguinte) em `mister-pg.teste-spec.ts`.

describe('C10a · os números de um texto', () => {
  it('lê reais, porcentagem e contagem no jeito do Brasil, com "mil" e o milhar com vírgula', () => {
    const n = numerosDoTexto('Novembro: R$ 98.400 · 3.120 pedidos · R$ 1.240,00 · 43% · 12,5% · R$ 98 mil · 98,400');
    expect(n.map((x) => [x.bruto, x.tipo, x.centavos])).toEqual([
      ['R$ 98.400', 'reais', 9_840_000],
      ['3.120', 'num', 312_000],
      ['R$ 1.240,00', 'reais', 124_000],
      ['43%', 'pct', 4_300],
      ['12,5%', 'pct', 1_250],
      ['R$ 98 mil', 'reais', 9_800_000],
      ['98,400', 'num', 9_840_000],
    ]);
  });
  it('data, hora, proporção e ordinal não são números do negócio', () => {
    expect(numerosDoTexto('de 01/11 a 30/11/2026, às 11:02 e 18h30, em 9:16, o 1º lugar')).toEqual([]);
  });
  it('o que se confere: reais, porcentagem e contagem acima de 31 que não é ano', () => {
    const negocio = numerosDoTexto('os 5 mais vendidos de 2026: 3.120 pedidos, R$ 9,90, 7%').filter(ehNumeroDoNegocio).map((x) => x.bruto);
    expect(negocio).toEqual(['3.120', 'R$ 9,90', '7%']);
    expect(numerosParaConferir('"R$ 98.400 · 3.120 pedidos" e de novo R$ 98.400')).toEqual(['R$ 98.400', '3.120']);
  });
});

describe('C10a · a origem dos números do pedido da imagem', () => {
  const consulta = { total: 98400, pedidos: 3120, porCategoria: [{ nome: 'Fornecedores', valor: 18420 }, { nome: 'Total', valor: 43310 }] };
  it('vale o que a consulta desta pergunta trouxe, a conta de dois números (porcentagem) e o redondo', () => {
    const o = { resultados: [consulta], falas: [] };
    expect(numerosSemOrigem('Cartaz: "R$ 98.400 · 3.120 pedidos". Fornecedores são 43% das contas.', o)).toEqual([]);
    expect(numerosSemOrigem('Quase R$ 98 mil em novembro.', o)).toEqual([]);
  });
  it('o número inventado ou trocado não passa', () => {
    const o = { resultados: [consulta], falas: [] };
    expect(numerosSemOrigem('Cartaz: "R$ 99.000 · 3.210 pedidos" e 61%.', o)).toEqual(['R$ 99.000', '3.210', '61%']);
  });
  it('o preço que a pessoa disse vale (a promoção do cartaz)', () => {
    const o = { resultados: [], falas: ['Faz um cartaz vertical da promoção de terça: smash duplo + batata por R$ 29,90.'] };
    expect(numerosSemOrigem('Texto exato: "TERÇA DO SMASH" e "Smash duplo + batata · R$ 29,90".', o)).toEqual([]);
    expect(numerosSemOrigem('Texto exato: "Smash duplo + batata · R$ 24,90".', o)).toEqual(['R$ 24,90']);
  });
  it('sem a origem do laço, nenhum número da loja passa; data e "os 5 mais" não precisam de origem', () => {
    expect(origemDe(undefined)).toEqual({ resultados: [], falas: [] });
    expect(origemDe({ resultados: 'x', falas: [1, 'ok'] })).toEqual({ resultados: [], falas: ['ok'] });
    expect(numerosSemOrigem('Cartaz com R$ 98.400.', origemDe(undefined))).toEqual(['R$ 98.400']);
    expect(numerosSemOrigem('Os 5 mais vendidos de novembro de 2026, de 01/11 a 30/11.', origemDe(undefined))).toEqual([]);
  });
});

describe('C10a · dado pessoal no pedido da imagem', () => {
  it('telefone, e-mail, CPF e CNPJ continuam barrados', () => {
    for (const t of ['ligue (21) 99999-0000', 'whatsapp 21 98888-7777', 'fale em dono@loja.com.br', 'CPF 123.456.789-09', 'CNPJ 12.345.678/0001-95', 'chave 21999990000'])
      expect(pareceDadoPessoalNaImagem(t)).toBe(true);
  });
  it('uma lista de valores não é telefone (a trava antiga barrava)', () => {
    for (const t of ['Fornecedores 18.420\nFolha 14.900\nAluguel 6.500', 'R$ 29,90 ou R$ 39,90', 'válido até 25/11/2026', 'siga @mister.burger', 'R$ 98.400 · 3.120 pedidos'])
      expect(pareceDadoPessoalNaImagem(t)).toBe(false);
  });
});

// O teste do dono (26/11, 10 imagens): 3 pedidos com números pequenos ("21 vendidos", "4" pedidos, a nota "5") passaram sem
// conferência, porque a regra tratava número até 31 como apresentação. Agora conta o texto exato (entre aspas), de qualquer tamanho.
describe('C10a · o texto exato entre aspas, com número pequeno', () => {
  const MAIS_VENDIDOS =
    'Infográfico dos 3 lanches mais vendidos da semana. Título: "Os mais vendidos da semana". Subtítulo: "23/11 a 26/11". Três linhas: "1º Numero 07 — 21 vendidos", "2º TRIO 09 — 20 vendidos", "3º TRIO 08 — 14 vendidos".';
  const RANKING = { itens: [{ nome: 'Numero 07', quantidade: 21 }, { nome: 'TRIO 09', quantidade: 20 }, { nome: 'TRIO 08', quantidade: 14 }] };
  it('conta todo número do texto exato, sem data, ordinal nem o "3" da instrução fora das aspas', () => {
    expect(numerosParaConferir(MAIS_VENDIDOS)).toEqual(['07', '21', '09', '20', '08', '14']);
    expect(numerosParaConferir('Cartaz. Número em destaque: "4". Abaixo: "pedidos de delivery".')).toEqual(['4']);
    expect(numerosParaConferir('Nota média: "5". Selo: "1 avaliação".')).toEqual(['5', '1']);
  });
  it('a origem do número pequeno e do número no nome do item ("TRIO 09"); o trocado não passa', () => {
    expect(numerosSemOrigem(MAIS_VENDIDOS, { resultados: [RANKING], falas: [] })).toEqual([]);
    expect(numerosSemOrigem(MAIS_VENDIDOS, { resultados: [{ itens: [{ nome: 'Numero 07', quantidade: 21 }, { nome: 'TRIO 09', quantidade: 20 }, { nome: 'TRIO 08', quantidade: 12 }] }], falas: [] })).toEqual(['14']);
    // O número de negócio FORA das aspas continua precisando de origem.
    expect(numerosSemOrigem('Cartaz "Hoje" com 61% em destaque.', { resultados: [], falas: [] })).toEqual(['61%']);
    // O ano do texto não precisa de origem.
    expect(numerosSemOrigem('Texto exato: "Melhor mês de 2026".', { resultados: [], falas: [] })).toEqual([]);
  });
  it('a imagem com um número pequeno trocado não passa', () => {
    const lida = { numeros: ['1º', 'Numero 07', '21 vendidos', '2º', 'TRIO 09', '20 vendidos', '3º', 'TRIO 08', '41 vendidos', '23/11 a 26/11'], ilegivel: false };
    expect(conferirNumeros(MAIS_VENDIDOS, lida)).toEqual({ situacao: 'errou', faltaram: ['14'], sobraram: [] });
    expect(conferirNumeros(MAIS_VENDIDOS, { ...lida, numeros: lida.numeros.map((n) => (n === '41 vendidos' ? '14 vendidos' : n)) }).situacao).toBe('bateu');
  });
});

describe('C10a · a conferência da imagem gerada', () => {
  const pedido = 'Cartaz quadrado. Texto exato: "Novembro, o melhor mês do ano!" e "R$ 98.400 · 3.120 pedidos".';
  it('bate com o número desenhado sem o "R$", e o ano e a data a mais não atrapalham', () => {
    expect(conferirNumeros(pedido, { numeros: ['98.400', '3.120 pedidos', '2026', '30/11'], ilegivel: false })).toEqual({ situacao: 'bateu', faltaram: [], sobraram: [] });
  });
  it('o dígito trocado é pego dos dois lados: faltou o do pedido, sobrou o da imagem', () => {
    const c = conferirNumeros(pedido, { numeros: ['R$ 89.400', '3.120 pedidos'], ilegivel: false });
    expect(c).toEqual({ situacao: 'errou', faltaram: ['R$ 98.400'], sobraram: ['R$ 89.400'] });
    expect(textoDaImagemErrada(c)).toMatch(/^a imagem saiu com R\$ 89\.400 no lugar de R\$ 98\.400\. Não te mandei/);
  });
  it('valor em reais ou porcentagem a mais na imagem também reprova; contagem solta, não', () => {
    expect(conferirNumeros(pedido, { numeros: ['R$ 98.400', '3.120', 'R$ 19,90', '10%', '7'], ilegivel: false })).toEqual({ situacao: 'errou', faltaram: [], sobraram: ['R$ 19,90', '10%'] });
  });
  it('número borrado é "ilegível", e o texto diz', () => {
    const c = conferirNumeros(pedido, { numeros: ['R$ 98.400'], ilegivel: true });
    expect(c.situacao).toBe('ilegivel');
    expect(textoDaImagemErrada(c)).toMatch(/^um número da imagem saiu borrado/);
  });
  it('a resposta da IA: o JSON pedido, mesmo com texto em volta; fora disso, null', () => {
    expect(lerConferencia('Aqui: {"numeros": ["R$ 98.400", 3], "ilegivel": false}')).toEqual({ numeros: ['R$ 98.400'], ilegivel: false });
    expect(lerConferencia('não consegui')).toBeNull();
    expect(lerConferencia('{"numeros": "R$ 1"}')).toBeNull();
  });
  it('o "feito" diz o que foi conferido', () => {
    expect(textoDaImagemConferida(['R$ 98.400', '3.120'])).toBe('Conferi os números da imagem: R$ 98.400 e 3.120, como no Regem.');
    expect(textoDaImagemConferida([])).toBe('');
  });
});
