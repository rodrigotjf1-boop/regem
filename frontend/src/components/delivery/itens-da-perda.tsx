'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Um item marcado como perdido: o item da venda e quanto dele (a API recebe isto em `perdaItens`/`itens`). */
export type MarcaDaPerda = { comandaItemId: string; quantidade: number };

/**
 * A lista do que se PERDEU no cancelamento (pedido do dono, 28/10/2026): os itens do pedido, todos marcados; o que não se
 * perdeu, desmarca-se — só o marcado sai do estoque (pela ficha técnica) e vai para Estoque › Desperdício. Item com mais de
 * uma unidade escolhe quantas se perderam. `itens` dados (o cupom do balcão já os tem) ou lidos do pedido (`pedidoId`).
 * `onChange(null)` enquanto a lista não carregou (quem chama não manda nada e o servidor faz o de sempre).
 */
export function ItensDaPerda({
  pedidoId,
  itens: dados,
  onChange,
}: {
  pedidoId?: string;
  itens?: { id: string; descricao: string; quantidade: number | string }[];
  onChange: (marcados: MarcaDaPerda[] | null) => void;
}) {
  const [itens, setItens] = useState<{ id: string; descricao: string; quantidade: number }[] | null>(
    dados ? dados.map((it) => ({ id: it.id, descricao: it.descricao, quantidade: Number(it.quantidade) || 1 })) : null,
  );
  const [erro, setErro] = useState(false);
  // quanto se perdeu de cada item (ausente = desmarcado)
  const [perdido, setPerdido] = useState<Record<string, number>>({});

  useEffect(() => {
    if (dados || !pedidoId) return;
    let vivo = true;
    api
      .itensDelivery(pedidoId)
      .then((l: any) => {
        if (vivo) setItens(((l as any[]) ?? []).map((it) => ({ id: it.id, descricao: it.descricao, quantidade: Number(it.quantidade) || 1 })));
      })
      .catch(() => vivo && setErro(true));
    return () => {
      vivo = false;
    };
  }, [pedidoId, dados]);

  // Todos marcados, no inteiro, quando a lista chega.
  useEffect(() => {
    if (itens) setPerdido(Object.fromEntries(itens.map((it) => [it.id, it.quantidade])));
  }, [itens]);

  // Avisa quem chama a cada mudança (pela referência: uma função nova a cada render não refaz o aviso).
  const avisar = useRef(onChange);
  avisar.current = onChange;
  useEffect(() => {
    avisar.current(itens ? Object.entries(perdido).map(([comandaItemId, quantidade]) => ({ comandaItemId, quantidade })) : null);
  }, [perdido, itens]);

  if (erro) return <p className="text-xs text-destructive">Não deu para ler os itens: o pedido inteiro conta como perdido.</p>;
  if (!itens) return <p className="text-xs text-muted-foreground">Carregando os itens…</p>;
  if (!itens.length) return <p className="text-xs text-muted-foreground">Este pedido não tem itens na venda.</p>;

  const marcar = (id: string, q: number | null) =>
    setPerdido((m) => {
      const n = { ...m };
      if (q == null) delete n[id];
      else n[id] = q;
      return n;
    });
  const marcados = Object.keys(perdido).length;

  return (
    <fieldset className="space-y-1.5 rounded-md border border-border p-2.5">
      <legend className="px-1 text-xs font-bold">O que se perdeu?</legend>
      <p className="text-xs text-muted-foreground">
        Desmarque o que <strong className="text-foreground">não</strong> se perdeu. Só o marcado sai do estoque, pela ficha
        técnica, e vai para Estoque › Desperdício.
      </p>
      <ul className="space-y-1">
        {itens.map((it) => {
          const q = perdido[it.id];
          const marcado = q != null;
          return (
            <li key={it.id} className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex min-w-0 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-destructive"
                  checked={marcado}
                  onChange={(e) => marcar(it.id, e.target.checked ? it.quantidade : null)}
                />
                <span className={`min-w-0 ${marcado ? 'font-semibold text-foreground' : 'text-muted-foreground line-through'}`}>
                  {it.quantidade}× {it.descricao}
                </span>
              </label>
              {marcado && it.quantidade > 1 && (
                <label className="flex items-center gap-1 text-xs">
                  perdeu
                  <select
                    className="rounded-md border border-input bg-card px-1.5 py-1 text-xs"
                    value={q}
                    onChange={(e) => marcar(it.id, Number(e.target.value))}
                    aria-label={`Quantos de ${it.descricao} se perderam`}
                  >
                    {Array.from({ length: it.quantidade }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs font-medium text-foreground" aria-live="polite">
        {marcados === 0 ? 'Nada marcado: o estoque não muda.' : `${marcados} de ${itens.length} ${itens.length === 1 ? 'item' : 'itens'} marcados como perdidos.`}
      </p>
    </fieldset>
  );
}
