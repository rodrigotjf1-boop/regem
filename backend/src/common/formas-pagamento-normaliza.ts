// Normaliza a forma de pagamento CRUA dos pedidos externos (iFood/Anota Aí/cardápio/
// marketplaces) para um TIPO canônico do Regem + rótulo padrão. Cada canal manda o
// mesmo método com N nomes (PT-BR, código em inglês, enum do iFood, `code` do Anota):
//   dinheiro = Dinheiro | dinheiro | money | CASH
//   pix      = Pix | PIX | ifood-online-pix-payin
//   crédito  = Cartão de crédito | CREDIT | Cartão/card (Anota: decide pelo cardSelected)
//   débito   = Cartão de débito | DEBIT
//   VR       = Vale-refeição | MEAL_VOUCHER | vr
//   online   = Pago online | online | DIGITAL_WALLET | OTHER
//   (entrega/retirada/balcao = TIPO de entrega vazado → tratado como "a combinar")

export type TipoForma = 'dinheiro' | 'pix' | 'credito' | 'debito' | 'vr' | 'online' | 'outro';

// Rótulo canônico por tipo — casa com as formas já cadastradas no Regem quando existem.
export const LABEL_FORMA: Record<TipoForma, string> = {
  dinheiro: 'Dinheiro',
  pix: 'Pix',
  credito: 'Cartão de crédito',
  debito: 'Cartão de débito',
  vr: 'Vale-refeição',
  online: 'Pago online',
  outro: 'A combinar',
};

export function normalizarFormaPagamento(
  bruto?: string | null,
  raw?: any,
): { tipo: TipoForma; label: string } {
  const s = String(bruto ?? '').trim().toLowerCase();
  // Anota Aí manda cartão genérico ('card'); o detalhe (crédito×débito) vem no raw.
  const pay = Array.isArray(raw?.payments) ? raw.payments[0] : null;
  const detalheCartao = String(pay?.cardSelected ?? pay?.externalId ?? '').toLowerCase();

  let tipo: TipoForma;
  if (/(dinheiro|money|cash|esp[eé]cie)/.test(s)) tipo = 'dinheiro';
  else if (/pix/.test(s)) tipo = 'pix';
  else if (/(vale.?refei|meal.?voucher|\bvr\b|ticket|sodexo|alelo|refei[cç])/.test(s)) tipo = 'vr';
  else if (/(d[eé]bito|\bdebit\b)/.test(s)) tipo = 'debito';
  else if (/(cr[eé]dito|\bcredit\b)/.test(s)) tipo = 'credito';
  else if (/(cart[aã]o|\bcard\b)/.test(s))
    tipo = /(d[eé]b)/.test(detalheCartao) ? 'debito' : 'credito'; // genérico → raw decide
  else if (/(carteira|wallet|pago online|online|prepaid|pr[eé].?pago)/.test(s)) tipo = 'online';
  else tipo = 'outro'; // OTHER / entrega / retirada / balcao / vazio → a combinar

  return { tipo, label: LABEL_FORMA[tipo] };
}
