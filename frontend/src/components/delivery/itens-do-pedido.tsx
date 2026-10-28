'use client';

import { itemComEscolhas } from '@/lib/escolhas-do-item';

/* eslint-disable @typescript-eslint/no-explicit-any */

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/**
 * Os itens do pedido no painel do delivery, como no Anota AI (pedido do dono, 28/10/2026): quantidade e produto em
 * negrito; embaixo, recuadas, as escolhas — uma por linha, em negrito (no combo, a batata e a bebida não passam batidas);
 * a observação do cliente destacada. `valor` = o preço da linha à direita (o detalhe soma pelo preço unitário; a prévia
 * usa o total que o pedido gravou).
 */
export function ItensDoPedido({
  itens,
  valor,
  compacto = false,
}: {
  itens: any[];
  valor: (it: any) => number | null;
  compacto?: boolean;
}) {
  if (!itens.length) return <p className="text-xs text-muted-foreground">Itens não detalhados neste pedido.</p>;
  const corpo = compacto ? 'text-xs' : 'text-sm';
  return (
    <ul className={`space-y-2 ${corpo}`}>
      {itens.map((it, i) => {
        const { nome, escolhas } = itemComEscolhas(it);
        const v = valor(it);
        return (
          <li key={i}>
            <div className="flex justify-between gap-2">
              <span className="min-w-0 font-bold text-foreground">
                <span className="font-mono">{Number(it.quantidade ?? 1)}×</span> {nome}
              </span>
              {v != null && v > 0 && <span className="shrink-0 font-mono text-foreground">{brl(v)}</span>}
            </div>
            {escolhas.length > 0 && (
              <ul className="mt-0.5 space-y-0.5 pl-5" aria-label={`Escolhas de ${nome}`}>
                {escolhas.map((e, k) => (
                  <li key={k} className="font-semibold text-foreground">
                    {e}
                  </li>
                ))}
              </ul>
            )}
            {it.observacao && (
              <p className="mt-0.5 pl-5 text-foreground">
                <span className="font-bold">Obs:</span> {it.observacao}
              </p>
            )}
          </li>
        );
      })}
    </ul>
  );
}
