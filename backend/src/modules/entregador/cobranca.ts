/* eslint-disable @typescript-eslint/no-explicit-any */

// Quanto o entregador recebe EM MÃOS num pedido — e em qual forma.
//
// O app mostrava `total` sempre que `pago` era false, e isso errava em dois casos caros:
//   1. pedido de marketplace pago online cujo `pago` não chegou true → o entregador
//      cobrava DE NOVO do cliente na porta;
//   2. pagamento DIVIDIDO (parte no PIX, parte em dinheiro) → `pago` é um booleano só,
//      não tem como estar certo.
//
// Fontes, em ordem de confiança:
//   1. `pagamentos` (mig 241) — soma só o que NÃO é pré-pago. Resolve o split.
//   2. `pago` — quitado (pelo canal ou pelo caixa da loja) → não cobra nada.
//   3. `valorPagoCliente` / `total` — base legada.
// Todos os caminhos só REDUZEM o valor cobrado: na dúvida o entregador pede menos,
// nunca cobra duas vezes.

export interface Cobranca {
  aReceber: number;
  prepago: boolean;
  jaPagoOnline: number;
  formasNaEntrega: { rotulo: string; valor: number }[];
  trocoPara: number | null;
  troco: number | null;
  cobrancaDetalhada: boolean;
}

const r2 = (v: number) => Number(v.toFixed(2));

export function calcularCobranca(p: any): Cobranca {
  const pgtos: any[] = Array.isArray(p?.pagamentos) ? p.pagamentos : [];
  const totalCliente = Number(p?.valorPagoCliente ?? p?.total) || 0;

  const naEntrega = pgtos.filter((x) => x && !x.prepago);
  const temDetalhe = pgtos.length > 0;
  let aReceber = p?.pago
    ? 0
    : temDetalhe
      ? r2(naEntrega.reduce((a, x) => a + (Number(x?.valor) || 0), 0))
      : totalCliente;
  if (!(aReceber > 0)) aReceber = 0; // cobre NaN e negativo

  // Troco: o cliente avisa com que nota vai pagar. Sem isso o entregador sai sem
  // trocado e a entrega trava na porta.
  const trocoPara = p?.trocoPara != null ? Number(p.trocoPara) || 0 : null;
  const troco =
    trocoPara != null && trocoPara > aReceber && aReceber > 0 ? r2(trocoPara - aReceber) : null;

  return {
    aReceber,
    prepago: aReceber <= 0,
    // Quanto já foi quitado online — o entregador vê que o pedido tem valor, mas não é
    // com ele. Sem isso, "A receber: R$ 0,00" num pedido de R$ 80 parece defeito do app.
    jaPagoOnline: r2(Math.max(0, totalCliente - aReceber)),
    formasNaEntrega: naEntrega.map((x) => ({
      rotulo: String(x?.rotulo ?? 'Pagamento'),
      valor: Number(x?.valor) || 0,
    })),
    trocoPara,
    troco,
    // Diz de onde veio o número — o app pode avisar quando a base ainda é a legada.
    cobrancaDetalhada: temDetalhe,
  };
}
