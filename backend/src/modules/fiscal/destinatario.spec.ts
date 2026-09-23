import {
  CNPJ_INTERMEDIADOR,
  EmissaoBloqueada,
  LIMITE_IDENTIFICACAO_NACIONAL,
  LIMITE_IDENTIFICACAO_PADRAO,
  decidirEmissao,
  documentoUtilizavel,
  limiteIdentificacao,
  pedidoFiscalDeJson,
  valoresFiscaisDoPedido,
} from './destinatario';

/* eslint-disable @typescript-eslint/no-explicit-any */

// COMO A OPERAÇÃO SE DECLARA À SEFAZ.
//
// Cada caso aqui é uma rejeição evitada, e a decisão acontece ANTES de reservar o número da
// nota — errar depois da reserva deixa buraco na numeração, e buraco a lei manda inutilizar.

const CONFIG: any = {
  cnpj: '36219750000104', razaoSocial: 'BAR DE TESTE LTDA', ie: '13047081',
  uf: 'RJ', municipio: 'Rio de Janeiro', codigoMunicipio: 3304557,
};

const ENTREGA = {
  canal: 'loja', tipo: 'entrega',
  documentoCliente: '111.444.777-35',
  clienteNome: 'Fulano',
  enderecoRua: 'Rua da Entrega', enderecoNumero: '12', enderecoBairro: 'Penha',
};

const decidir = (over: any = {}) =>
  decidirEmissao({
    pedido: null, config: CONFIG, taxaEntrega: 0, valorTotal: 50,
    ...over,
  });

describe('limite de identificação do consumidor (W16-40 → 750)', () => {
  it('o RJ tem limite próprio, e não o default nacional', () => {
    expect(limiteIdentificacao('RJ')).toBe(2000);
    expect(limiteIdentificacao('RJ')).not.toBe(LIMITE_IDENTIFICACAO_NACIONAL);
  });

  it('cada UF levantada tem o seu — e nenhuma usa o default nacional', () => {
    expect(limiteIdentificacao('CE')).toBe(200);
    expect(limiteIdentificacao('PE')).toBe(5000);
    expect(limiteIdentificacao('MT')).toBe(1000);
  });

  it('UF ainda não levantada cai no piso MAIS RESTRITIVO, não nos R$ 10.000 da norma', () => {
    // Pedir um CPF a mais é aborrecimento; a rejeição 750 gasta número de nota.
    expect(limiteIdentificacao('AC')).toBe(LIMITE_IDENTIFICACAO_PADRAO);
    expect(limiteIdentificacao('AC')).toBeLessThan(LIMITE_IDENTIFICACAO_NACIONAL);
  });

  it('o valor configurado na loja vence a tabela — a norma diz "ou outro valor definido pela UF"', () => {
    expect(limiteIdentificacao('RJ', 500)).toBe(500);
    expect(limiteIdentificacao('RJ', null)).toBe(2000);
    expect(limiteIdentificacao('RJ', 0)).toBe(2000);
  });

  it('venda acima do limite sem documento do consumidor é recusada antes de gastar número', () => {
    expect(() => decidir({ valorTotal: 2500 })).toThrow(EmissaoBloqueada);
    expect(() => decidir({ valorTotal: 2500 })).toThrow(/CPF ou CNPJ/);
  });

  it('com o documento do consumidor, o mesmo valor passa', () => {
    const d = decidir({ valorTotal: 2500, pedido: { tipo: 'balcao', documentoCliente: '11144477735' } });
    expect(d.dest?.documento).toBe('11144477735');
  });
});

describe('documento do cliente', () => {
  it('CPF com dígito verificador errado é tratado como ausente (não vira rejeição 237)', () => {
    expect(documentoUtilizavel('11144477700')).toBeNull();
    expect(documentoUtilizavel('111.444.777-35')).toBe('11144477735');
    expect(documentoUtilizavel('11.222.333/0001-81')).toBe('11222333000181');
    expect(documentoUtilizavel('123')).toBeNull();
    expect(documentoUtilizavel(null)).toBeNull();
  });

  it('CPF inválido num pedido de entrega não bloqueia: a nota sai presencial, sem destinatário', () => {
    const d = decidir({ pedido: { ...ENTREGA, documentoCliente: '11144477700' }, taxaEntrega: 8 });
    expect(d.indPres).toBe(1);
    expect(d.dest).toBeNull();
    expect(d.semDocumentoCliente).toBe(true);
  });
});

describe('entrega a domicílio (indPres=4)', () => {
  it('com documento e endereço: destinatário, transportador e a taxa como FRETE', () => {
    const d = decidir({ pedido: ENTREGA, taxaEntrega: 8 });
    expect(d.indPres).toBe(4);
    expect(d.dest?.documento).toBe('11144477735');
    expect(d.dest?.endereco?.logradouro).toBe('Rua da Entrega');
    expect(d.frete).toBe(8);
    expect(d.outras).toBe(0);
    expect(d.semDocumentoCliente).toBe(false);
  });

  it('o transportador é a própria loja — é o que o manual da SEFAZ-RJ manda', () => {
    const d = decidir({ pedido: ENTREGA, taxaEntrega: 8 });
    expect(d.transportador).toMatchObject({ documento: CONFIG.cnpj, nome: CONFIG.razaoSocial, uf: 'RJ' });
  });

  it('endereço sem município/UF usa o do emitente — o delivery é intramunicipal', () => {
    const d = decidir({ pedido: ENTREGA, taxaEntrega: 8 });
    expect(d.dest?.endereco?.municipio).toBe('Rio de Janeiro');
    expect(d.dest?.endereco?.uf).toBe('RJ');
    expect(String(d.dest?.endereco?.codigoMunicipio)).toBe('3304557');
  });

  it('quando o pedido informa o município dele, é o do pedido que vale', () => {
    const d = decidir({
      pedido: { ...ENTREGA, enderecoCidade: 'Niteroi', enderecoMunicipioIbge: 3303302, enderecoUf: 'RJ' },
      taxaEntrega: 8,
    });
    expect(d.dest?.endereco?.municipio).toBe('Niteroi');
    expect(String(d.dest?.endereco?.codigoMunicipio)).toBe('3303302');
  });

  it('sem número da casa, sai S/N em vez de endereço incompleto', () => {
    const d = decidir({ pedido: { ...ENTREGA, enderecoNumero: '' }, taxaEntrega: 8 });
    expect(d.dest?.endereco?.numero).toBe('S/N');
  });

  it('endereço pela metade (sem bairro) não vira indPres=4 — seria rejeição 788', () => {
    const d = decidir({ pedido: { ...ENTREGA, enderecoBairro: '' }, taxaEntrega: 8 });
    expect(d.indPres).toBe(1);
    expect(d.dest?.endereco).toBeNull();
    expect(d.frete).toBe(0);
    expect(d.outras).toBe(8);
  });
});

describe('pedido não presencial SEM o CPF do cliente', () => {
  const semCpf = { ...ENTREGA, documentoCliente: null };

  it('padrão da loja: emite presencial, sem frete, com a taxa em outras despesas', () => {
    const d = decidir({ pedido: semCpf, taxaEntrega: 8 });
    expect(d.indPres).toBe(1);
    expect(d.dest).toBeNull();
    expect(d.transportador).toBeNull(); // 754: transportador fora da entrega é proibido
    expect(d.frete).toBe(0); // 753: frete idem
    expect(d.outras).toBe(8); // o total tem de bater com o que o cliente pagou
    expect(d.semDocumentoCliente).toBe(true);
  });

  it('loja que escolheu não emitir nesse caso: a emissão é recusada com o motivo', () => {
    expect(() =>
      decidir({ pedido: semCpf, config: { ...CONFIG, deliverySemCpf: 'nao_emitir' }, taxaEntrega: 8 }),
    ).toThrow(/não emitir/);
  });

  it('a escolha "não emitir" não atrapalha a venda de balcão', () => {
    const d = decidir({ config: { ...CONFIG, deliverySemCpf: 'nao_emitir' } });
    expect(d.indPres).toBe(1);
    expect(d.semDocumentoCliente).toBe(false);
  });
});

describe('venda de balcão', () => {
  it('sem pedido de canal: presencial, sem destinatário, sem intermediador', () => {
    const d = decidir();
    expect(d).toMatchObject({ indPres: 1, dest: null, transportador: null, intermediador: null, frete: 0, outras: 0 });
  });

  it('com o CPF que o cliente pediu no caixa: o destinatário sai na nota presencial', () => {
    const d = decidir({ pedido: { tipo: 'balcao', documentoCliente: '11144477735', clienteNome: 'Fulano' } });
    expect(d.indPres).toBe(1);
    expect(d.dest).toEqual({ documento: '11144477735', nome: 'Fulano', endereco: null });
    expect(d.semDocumentoCliente).toBe(false); // venda presencial não tem obrigação de CPF
  });

  it('retirada no balcão não é entrega a domicílio: sem transportador e sem frete', () => {
    const d = decidir({ pedido: { ...ENTREGA, tipo: 'retirada' }, taxaEntrega: 0 });
    expect(d.indPres).toBe(1);
    expect(d.transportador).toBeNull();
  });
});

describe('intermediador (marketplace)', () => {
  afterEach(() => {
    for (const k of Object.keys(CNPJ_INTERMEDIADOR)) delete CNPJ_INTERMEDIADOR[k];
  });

  it('canal de marketplace sem o CNPJ do intermediador é RECUSADO, nunca declarado como venda direta', () => {
    expect(() => decidir({ pedido: { ...ENTREGA, canal: 'ifood', merchantId: 'M1' } })).toThrow(/CNPJ do intermediador/);
  });

  it('com o CNPJ cadastrado, sai o grupo com a identificação da loja no app', () => {
    CNPJ_INTERMEDIADOR.ifood = '11222333000181';
    const d = decidir({ pedido: { ...ENTREGA, canal: 'ifood', merchantId: 'M1' }, taxaEntrega: 0 });
    expect(d.intermediador).toEqual({ cnpj: '11222333000181', idCadIntTran: 'M1' });
  });

  it('sem a identificação da loja no app, também recusa — o grupo é tudo ou nada', () => {
    CNPJ_INTERMEDIADOR.ifood = '11222333000181';
    expect(() => decidir({ pedido: { ...ENTREGA, canal: 'ifood', merchantId: null } })).toThrow(/identificação da loja/);
  });

  it('o cardápio do próprio Regem é plataforma PRÓPRIA: sem intermediador', () => {
    const d = decidir({ pedido: { ...ENTREGA, canal: 'loja' }, taxaEntrega: 0 });
    expect(d.intermediador).toBeNull();
  });
});

describe('valores fiscais lidos da linha do pedido', () => {
  it('taxa de entrega do MARKETPLACE não entra na nota da loja', () => {
    expect(valoresFiscaisDoPedido({ taxa_entrega: '9', taxa_entrega_dono: 'marketplace' })).toEqual({
      taxaEntrega: 0, desconto: 0,
    });
  });

  it('taxa de entrega da LOJA entra', () => {
    expect(valoresFiscaisDoPedido({ taxa_entrega: '9', taxa_entrega_dono: 'loja' }).taxaEntrega).toBe(9);
  });

  it('só o desconto bancado pela loja é desconto fiscal, e o de frete fica fora', () => {
    const r = valoresFiscaisDoPedido({
      descontos: [
        { valor: 5, quemBanca: 'loja' },
        { valor: 7, quemBanca: 'marketplace' },
        { valor: 3, quemBanca: 'loja', alvo: 'DELIVERY_FEE' },
      ],
    });
    expect(r.desconto).toBe(5);
  });

  it('sem a lista de descontos, vale o desconto_loja', () => {
    expect(valoresFiscaisDoPedido({ desconto_loja: '4.50' }).desconto).toBe(4.5);
  });

  it('linha ausente não quebra nada', () => {
    expect(valoresFiscaisDoPedido(null)).toEqual({ taxaEntrega: 0, desconto: 0 });
    expect(pedidoFiscalDeJson(null)).toBeNull();
  });

  it('a linha crua do banco vira o pedido que a decisão entende', () => {
    const p = pedidoFiscalDeJson(
      {
        canal: 'ifood', tipo: 'entrega', documento_cliente: '11144477735', cliente_nome: 'Fulano',
        endereco_rua: 'Rua A', endereco_numero: '1', endereco_bairro: 'Centro',
        endereco_cidade: 'Niteroi', endereco_municipio_ibge: 3303302, endereco_uf: 'RJ', endereco_cep: '24000000',
      },
      'MERCHANT-1',
    );
    expect(p).toMatchObject({
      canal: 'ifood', tipo: 'entrega', documentoCliente: '11144477735',
      enderecoCidade: 'Niteroi', enderecoMunicipioIbge: 3303302, merchantId: 'MERCHANT-1',
    });
  });

  it('numa loja com o edge desatualizado, as colunas novas simplesmente não vêm — e não quebram', () => {
    const p = pedidoFiscalDeJson({ canal: 'loja', tipo: 'entrega', endereco_rua: 'Rua A', endereco_bairro: 'Centro' });
    expect(p?.documentoCliente).toBeNull();
    expect(p?.enderecoUf).toBeNull();
  });
});
