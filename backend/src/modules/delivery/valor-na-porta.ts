// O QUE O CLIENTE DEVE NA PORTA — revisão do cardápio e delivery de 25/11/2026 (CAR-C-03, CAR-C-04, CAR-D-04).
//
// O total do pedido (`pedido_externo.total`) já é o que o cliente paga: os itens, mais o frete, menos o desconto. Desse total sai o que
// ele já pagou ANTES — a parcela pré-paga que o canal informa (`pedido_externo.pagamentos[].prepago`, mig 241: na Anota Aí, R$ 30 de
// Pix antecipado e R$ 20 em dinheiro na entrega). O resto é o que o entregador (ou o balcão) recebe e o que a gaveta tem de esperar.
// Tudo em CENTAVOS inteiros. A tela tem a mesma conta em `frontend/src/lib/valor-na-porta.ts`.

type Parcela = { valor?: unknown; prepago?: unknown };

/** As parcelas do canal como vieram (jsonb): lista, texto JSON ou nada. */
function parcelas(pagamentos: unknown): Parcela[] {
  if (Array.isArray(pagamentos)) return pagamentos as Parcela[];
  if (typeof pagamentos === 'string') {
    try {
      const v = JSON.parse(pagamentos);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Centavos já pagos antes da entrega (as parcelas marcadas como pré-pagas). */
export function centavosPrePagos(pagamentos: unknown): number {
  return parcelas(pagamentos)
    .filter((p) => p?.prepago === true || p?.prepago === 'true')
    .reduce((s, p) => s + Math.max(0, Math.round((Number(p?.valor) || 0) * 100)), 0);
}

/** Centavos que o cliente deve na porta: o total menos o pré-pago (nunca negativo). 0 = nada a conferir. */
export function centavosDevidosNaPorta(total: unknown, pagamentos: unknown): number {
  const t = Math.round((Number(total) || 0) * 100);
  return Math.max(0, t - centavosPrePagos(pagamentos));
}

/** O pedido está quitado pelas parcelas do canal? Só quando TODAS são pré-pagas (a ordem das parcelas não muda nada — CAR-D-04). */
export function todasPrePagas(pagamentos: unknown): boolean {
  const ps = parcelas(pagamentos).filter((p) => (Number(p?.valor) || 0) > 0);
  return ps.length > 0 && ps.every((p) => p?.prepago === true || p?.prepago === 'true');
}

/** "R$ 1.234,56" a partir de centavos (para a frase de recusa). */
export function reaisDeCentavos(c: number): string {
  return (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
