import {
  ACOES,
  ACOES_DE_PIN,
  apresentacaoDaBaixa,
  conferirAcao,
  dataBr,
  lerDataDoPagamento,
  lerFormaDaBaixa,
  linhaDaConta,
  resumoDaBaixa,
  sigaDaAcao,
  textoDaBaixaFeita,
  type BaixaDeConta,
} from './mister-acoes';

// M6j, lote 10: marcar uma conta a pagar como paga, com o PIN pelo link. O Regem registra a baixa; não paga no banco.

const base: BaixaDeConta = {
  descricao: 'Aluguel',
  fornecedor: 'Imobiliária Centro',
  valor: 1200.5,
  vencimento: '2026-12-10',
  forma: 'pix',
  pagoEm: '2026-11-21',
  recorrente: false,
};

describe('Mister · ações (lote 10) — marcar a conta como paga', () => {
  it('é de PIN, pela permissão da rota e com "Ver valores em R$"', () => {
    expect(ACOES_DE_PIN).toEqual(['mudar_preco', 'mudar_horario', 'pagar_conta', 'criar_cupom', 'lancar_conta', 'classificar_banco', 'fechar_caixa', 'sangria', 'pagar_entregador']);
    expect(ACOES.pagar_conta).toMatchObject({ nivel: 'pin', permissao: 'financeiro', prazoMin: 15, pedeVerValores: true });
    expect(sigaDaAcao('pagar_conta')).toContain('Abrir no Regem');
    expect(sigaDaAcao('pagar_conta')).toContain('nunca diga que pagou');
  });

  it('a forma é uma das quatro da tela', () => {
    expect(['dinheiro', 'PIX', 'cartão', 'Transferência'].map(lerFormaDaBaixa)).toEqual(['dinheiro', 'pix', 'cartao', 'transferencia']);
    for (const ruim of ['boleto', 'fiado', '', null, undefined, 1]) expect(lerFormaDaBaixa(ruim)).toBeNull();
  });

  it('a data do pagamento: dia de verdade, de hoje para trás, até 60 dias', () => {
    const hoje = '2026-11-21';
    expect(lerDataDoPagamento('2026-11-21', hoje)).toBe('2026-11-21');
    expect(lerDataDoPagamento('2026-09-22', hoje)).toBe('2026-09-22');
    for (const ruim of ['2026-11-22', '2026-09-21', '2026-02-31', '21/11/2026', 'ontem', '', null, 20261121]) expect(lerDataDoPagamento(ruim, hoje)).toBeNull();
  });

  it('pede a conta e a forma; confere o vencimento, a data e o valor ditos', () => {
    const agora = new Date('2026-11-21T15:00:00Z');
    expect(conferirAcao('pagar_conta', { conta: ' Aluguel  da loja ', formaDePagamento: 'pix', venceEm: '10/12', pagoEm: '2026-11-20', valorPago: 1200.5 }, agora)).toMatchObject({
      parametros: { acao: 'pagar_conta', conta: 'Aluguel da loja', forma: 'pix', venceEm: '10/12', pagoEm: '2026-11-20', valorPago: 1200.5 },
    });
    expect(conferirAcao('pagar_conta', { conta: 'Aluguel', formaDePagamento: 'pix' }, agora)).toMatchObject({ parametros: { venceEm: null, pagoEm: null, valorPago: null } });
    for (const en of [
      { formaDePagamento: 'pix' },
      { conta: 'Aluguel' },
      { conta: '%%', formaDePagamento: 'pix' },
      { conta: '_', formaDePagamento: 'pix' },
      { conta: 'Aluguel', formaDePagamento: 'boleto' },
      { conta: 'Aluguel', formaDePagamento: 'pix', venceEm: '10-12' },
      { conta: 'Aluguel', formaDePagamento: 'pix', pagoEm: '2026-11-22' },
      { conta: 'Aluguel', formaDePagamento: 'pix', valorPago: -1 },
      { conta: 'Aluguel', formaDePagamento: 'pix', valorPago: '1200,50' },
    ])
      expect(conferirAcao('pagar_conta', en, agora)).toHaveProperty('erro');
  });

  it('o resumo diz a conta, o valor e que só registra: o pagamento no banco não sai daqui', () => {
    expect(resumoDaBaixa(base)).toBe(
      'Marcar como paga a conta "Aluguel" (Imobiliária Centro) de R$ 1.200,50, vencimento 10/12, em Pix, com data de 21/11/2026. Isso só registra no Regem a saída do caixa: o pagamento no banco não sai daqui.',
    );
    expect(resumoDaBaixa({ ...base, recorrente: true })).toContain('a próxima é criada em aberto');
    expect(resumoDaBaixa({ ...base, fornecedor: null, vencimento: null })).toContain('"Aluguel" de R$ 1.200,50, em Pix');
  });

  it('a página mostra o valor, a forma, a data e o aviso', () => {
    expect(apresentacaoDaBaixa(base)).toEqual({
      titulo: 'Marcar como paga a conta "Aluguel"?',
      detalhe: 'Imobiliária Centro · vence 10/12',
      valor: 1200.5,
      botao: 'Marcar como paga',
      itens: ['Forma: Pix.', 'Data do pagamento: 21/11/2026.', 'Isso só registra no Regem a saída do caixa: o pagamento no banco não sai daqui.'],
    });
    expect(apresentacaoDaBaixa({ ...base, fornecedor: null, vencimento: null }).detalhe).toBeNull();
  });

  it('a lista de "qual delas" e o desfecho', () => {
    expect(linhaDaConta(base)).toBe('"Aluguel" (vence 10/12, R$ 1.200,50)');
    expect(linhaDaConta({ ...base, vencimento: null })).toBe('"Aluguel" (sem vencimento, R$ 1.200,50)');
    expect(dataBr('2027-01-10')).toBe('10/01/2027');
    const feito = textoDaBaixaFeita(base, '2027-01-10');
    expect(feito).toContain('ficou paga: saída de R$ 1.200,50 em Pix, com data de 21/11/2026.');
    expect(feito).toContain('A próxima vence em 10/01/2027.');
    expect(feito).toContain('"Estornar" em Financeiro › Contas a pagar');
    expect(textoDaBaixaFeita(base, null)).not.toContain('próxima');
  });
});
