'use client';

import { Minus, Pencil, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export type ItemDoPedido = {
  key: string;
  produtoId: string;
  variacaoId?: string;
  complementos?: string[]; // ids das opções escolhidas (o id repetido conta)
  observacao?: string;
  nome: string;
  escolhas?: string[]; // "+ 2x Bacon", "sem Cebola"
  preco: number; // unitário, já com os adicionais
  qtd: number;
};

// Uma linha do pedido no balcão, em UMA faixa: quantidade (− n +), o item (tocar abre escolhas e
// observação — o lápis pequeno ao lado do nome avisa), o valor e o botão de tirar. Onde a coluna é
// estreita a faixa quebra sozinha em duas (o valor e o botão descem) — nada rola para o lado.
export function LinhaDoPedido({
  item,
  destaque,
  onQtd,
  onEditar,
  onTirar,
}: {
  item: ItemDoPedido;
  destaque?: boolean; // acabou de entrar ou de mudar
  onQtd: (delta: number) => void;
  onEditar: () => void;
  onTirar: () => void;
}) {
  const botao = 'grid h-9 w-9 flex-none place-items-center rounded-md hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
  return (
    <li
      data-linha={item.key}
      className={cn(
        'flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-dashed border-border px-1 py-1 transition-colors duration-700 last:border-b-0',
        destaque && 'bg-primary/15',
      )}
    >
      <div role="group" aria-label={`Quantidade de ${item.nome}`} className="flex flex-none items-center rounded-md border border-border bg-card">
        <button type="button" onClick={() => onQtd(-1)} disabled={item.qtd <= 1} aria-label={`Diminuir ${item.nome}`} className={cn(botao, 'disabled:opacity-30')}>
          <Minus className="h-4 w-4" aria-hidden="true" />
        </button>
        <span className="w-6 text-center font-mono text-sm font-bold">{item.qtd}</span>
        <button type="button" onClick={() => onQtd(1)} aria-label={`Aumentar ${item.nome}`} className={botao}>
          <Plus className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        onClick={onEditar}
        title="Escolhas e observação"
        aria-label={`${item.nome}: escolhas e observação`}
        className="min-w-[8.5rem] flex-1 rounded-md px-1 py-0.5 text-left hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="block text-sm font-semibold leading-tight">
          {item.nome}
          <Pencil className="ml-1.5 inline h-3 w-3 align-baseline text-muted-foreground" aria-hidden="true" />
        </span>
        {!!item.escolhas?.length && <span className="block text-xs leading-snug text-muted-foreground">{item.escolhas.join(' · ')}</span>}
        {item.observacao && <span className="block text-xs font-semibold leading-snug text-foreground">obs: {item.observacao}</span>}
      </button>
      <span className="ml-auto flex flex-none items-center gap-1">
        <b className="mr-1 whitespace-nowrap font-mono text-sm">{brl(item.preco * item.qtd)}</b>
        <button type="button" onClick={onTirar} aria-label={`Tirar ${item.nome} do pedido`} className={cn(botao, 'border border-border text-destructive')}>
          <Trash2 className="h-4 w-4" aria-hidden="true" />
        </button>
      </span>
    </li>
  );
}
