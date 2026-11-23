import { normalizarFormaPagamento, type TipoForma } from './formas-pagamento-normaliza';

// Os valores que os canais gravam de verdade em `pedido_externo.forma_pagamento` e `comanda.forma` (ERR-587).
const CASOS: [string, TipoForma][] = [
  ['Dinheiro', 'dinheiro'],
  ['money', 'dinheiro'],
  ['CASH', 'dinheiro'],
  ['Pix', 'pix'],
  ['pix_auto', 'pix'],
  ['ifood-online-pix-payin', 'pix'],
  ['Cartão de crédito', 'credito'],
  ['CREDIT', 'credito'],
  ['credit_card', 'credito'],
  ['cartao_credito', 'credito'],
  ['Cartão de débito', 'debito'],
  ['DEBIT', 'debito'],
  ['debit_card', 'debito'],
  ['cartao_debito', 'debito'],
  ['card', 'credito'],
  ['Cartão', 'credito'],
  ['Vale-refeição', 'vr'],
  ['vr', 'vr'],
  ['meal_voucher', 'vr'],
  ['MEAL_VOUCHER', 'vr'],
  ['online', 'online'],
  ['Pago online', 'online'],
  ['digital_wallet', 'online'],
  ['DIGITAL_WALLET', 'online'],
  // Fiado não é débito: `debt` não pode cair em `debit`.
  ['debt_book', 'outro'],
  ['custom', 'outro'],
  ['OTHER', 'outro'],
  ['entrega', 'outro'],
  ['', 'outro'],
];

describe('normalizarFormaPagamento', () => {
  it.each(CASOS)('%s → %s', (cru, tipo) => {
    expect(normalizarFormaPagamento(cru).tipo).toBe(tipo);
  });

  it('o cartão genérico do Anota Aí continua decidido pelo detalhe do pedido', () => {
    const raw = { payments: [{ cardSelected: 'Débito Visa' }] };
    expect(normalizarFormaPagamento('card', raw).tipo).toBe('debito');
  });

  it('devolve o rótulo do Regem', () => {
    expect(normalizarFormaPagamento('credit_card').label).toBe('Cartão de crédito');
    expect(normalizarFormaPagamento('debit_card').label).toBe('Cartão de débito');
  });
});
