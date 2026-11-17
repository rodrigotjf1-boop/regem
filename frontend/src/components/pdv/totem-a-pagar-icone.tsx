'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Banknote } from 'lucide-react';
import { naTelaDoTotem, resumoDoTotemAPagar, rotuloDoIcone, senhaDoTotem } from '@/lib/totem-a-pagar';
import { useTotemAPagar } from './totem-a-pagar-dados';

// O ÍCONE do totem em dinheiro (pedido do dono, 16/11/2026): aparece JÁ na chegada do pedido, em todos os PDVs, com a
// contagem dos que esperam pagamento; com algum PRONTO e não pago, fica vermelho e pulsando. O clique leva a
// Retirada / Encomendas, onde se cobra. Some quando não há nenhum. Vai no topo do Shell e no cabeçalho do PDV · Balcão
// (que não tem o topo).
export function TotemAPagarIcone({ ativo = true }: { ativo?: boolean }) {
  const path = usePathname() ?? '';
  const { pedidos } = useTotemAPagar(ativo && naTelaDoTotem(path));
  if (!pedidos.length) return null;
  const r = resumoDoTotemAPagar(pedidos);
  const urgente = r.prontos.length > 0;
  const dica = pedidos
    .slice(0, 8)
    .map((p) => `${senhaDoTotem(p)}${p.pronto ? ' · PRONTO' : ''}`)
    .join(' | ');
  return (
    <Link
      href="/pdv/retirada"
      aria-label={rotuloDoIcone(r)}
      title={dica}
      data-totem-a-pagar={r.total}
      className={`relative inline-flex h-9 flex-none items-center gap-1.5 rounded-md border px-2.5 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        urgente
          ? 'border-destructive bg-destructive text-white motion-safe:animate-pulse'
          : 'border-primary bg-primary/15 text-foreground hover:bg-primary/25'
      }`}
    >
      <Banknote className="h-4 w-4 flex-none" aria-hidden="true" />
      <span className="hidden sm:inline">{urgente ? 'Pronto sem pagar' : 'Totem a pagar'}</span>
      <span
        aria-hidden="true"
        className={`grid h-5 min-w-5 place-items-center rounded-full px-1 font-mono text-[11px] font-bold ${
          urgente ? 'bg-white text-destructive' : 'bg-destructive text-white'
        }`}
      >
        {r.total}
      </span>
    </Link>
  );
}
