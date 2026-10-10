'use client';

import { X } from 'lucide-react';
import { brl, num, texto2 } from '@/components/ui/lista';
import type { LinhaDoPedido } from '@/lib/produto-compra';

// A prévia do pedido, ao lado da escolha dos produtos (pedido do dono, 10/10/2026): o que já foi
// marcado, na ordem em que foi marcado, com a quantidade, a marca e o total — para acompanhar o
// pedido enquanto ele é montado. O X tira o produto do pedido. No celular vem abaixo da lista.
export function PreviaDoPedido({ linhas, verFin, aoTirar }: { linhas: LinhaDoPedido[]; verFin: boolean; aoTirar: (id: string) => void }) {
  const semQuantidade = linhas.filter((l) => !(l.quantidade > 0)).length;
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  return (
    <aside aria-labelledby="previa-titulo" className="rounded-lg border border-border bg-secondary/60 p-3 text-sm lg:sticky lg:top-0 lg:max-h-[70vh] lg:overflow-y-auto">
      <h3 id="previa-titulo" className="font-display text-base font-bold">Seu pedido</h3>
      <p className={`text-xs ${texto2}`} role="status" aria-live="polite">
        {linhas.length === 0 ? 'Nenhum produto ainda.' : `${linhas.length} ${linhas.length === 1 ? 'produto' : 'produtos'}${semQuantidade ? ` · ${semQuantidade} sem quantidade` : ''}`}
      </p>
      {linhas.length === 0 ? (
        <p className={`mt-2 ${texto2}`}>Marque os produtos na lista: eles aparecem aqui, com a quantidade e a marca.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {linhas.map((l) => (
            <li key={l.id} className="flex items-start gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block break-words font-semibold">{l.titulo}</span>
                <span className="block break-words text-xs">
                  {l.quantidade > 0 ? <><span className="font-mono">{num(l.quantidade)}</span> {l.unidade}</> : <b>sem quantidade</b>}
                  {l.marca ? ` · ${l.marca}` : ''}
                  {l.segunda ? ` · 2ª opção: ${l.segunda}` : ''}
                  {l.faltaMarca && <b> · falta a marca</b>}
                </span>
              </span>
              {verFin && l.valor > 0 && <span className="whitespace-nowrap font-mono text-xs">{brl(l.valor)}</span>}
              <button type="button" title="Tirar do pedido" aria-label={`Tirar ${l.titulo} do pedido`}
                className={`-mr-1 inline-flex h-9 w-9 flex-none items-center justify-center rounded-md ${texto2} hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                onClick={() => aoTirar(l.id)}>
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {verFin && total > 0 && (
        <p className="mt-1 flex items-baseline justify-between gap-2 border-t border-border pt-2 font-bold">
          Total estimado <span className="font-mono">{brl(total)}</span>
        </p>
      )}
    </aside>
  );
}
