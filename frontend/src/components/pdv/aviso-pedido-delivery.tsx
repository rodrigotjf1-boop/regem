'use client';

import Link from 'next/link';

/**
 * A venda é de um pedido de delivery ainda em andamento: ela se cancela no painel do delivery, que avisa o canal e
 * devolve o cashback e os pontos do cliente. Aparece no lugar do "Cancelar venda" (o servidor recusa por aqui).
 */
export function AvisoPedidoDelivery({ pedido }: { pedido: { rotulo: string } }) {
  return (
    <div role="note" className="space-y-2 rounded-lg border border-warn/60 bg-warn/10 p-3 text-sm text-foreground">
      <p>
        <b>Venda do pedido de delivery {pedido.rotulo}</b>, que ainda está em andamento.
      </p>
      <p>
        Para cancelar, use <b>Delivery › Painel</b> (botão <b>CANCELAR</b>): lá o cancelamento avisa o canal e devolve o
        cashback e os pontos do cliente.
      </p>
      <Link
        href="/delivery"
        className="inline-flex min-h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-semibold hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Abrir o painel do delivery
      </Link>
    </div>
  );
}
