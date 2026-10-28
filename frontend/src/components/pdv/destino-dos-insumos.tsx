'use client';

import { ItensDaPerda, type MarcaDaPerda } from '@/components/delivery/itens-da-perda';

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * O destino do que a venda do balcão já gastou, no cancelamento (pedido do dono, 28/10/2026): REUTILIZADO (volta ao
 * estoque) ou PERDA — e, na perda, a lista dos itens, todos marcados: o que não se perdeu desmarca-se; só o marcado sai
 * do estoque, pela ficha técnica, e vai para Estoque › Desperdício.
 */
export function DestinoDosInsumos({
  itens,
  reaproveitado,
  onReaproveitado,
  onPerda,
}: {
  itens: any[];
  reaproveitado: boolean;
  onReaproveitado: (v: boolean) => void;
  onPerda: (marcados: MarcaDaPerda[] | null) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium">O que aconteceu com o que já foi feito?</p>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        <button
          type="button"
          aria-pressed={reaproveitado}
          onClick={() => onReaproveitado(true)}
          className={`rounded-md border px-2 py-1.5 text-xs font-medium ${reaproveitado ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground'}`}
        >
          ♻️ Reutilizado (volta ao estoque)
        </button>
        <button
          type="button"
          aria-pressed={!reaproveitado}
          onClick={() => onReaproveitado(false)}
          className={`rounded-md border px-2 py-1.5 text-xs font-medium ${!reaproveitado ? 'border-destructive bg-destructive/10 text-destructive' : 'border-border text-muted-foreground'}`}
        >
          🗑️ Perda (sai do estoque)
        </button>
      </div>
      {!reaproveitado && (
        <ItensDaPerda
          itens={itens.map((it) => ({ id: it.id, descricao: it.descricao, quantidade: it.quantidade }))}
          onChange={onPerda}
        />
      )}
    </div>
  );
}
