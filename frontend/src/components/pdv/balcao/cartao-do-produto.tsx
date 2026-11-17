'use client';

import { SlidersHorizontal, UtensilsCrossed } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** A grade dos cartões: cada coluna com no mínimo 9,5 rem, quantas couberem (sem barra para o lado em largura nenhuma). */
export const GRADE_DE_PRODUTOS = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-2.5';

// O CARTÃO DO PRODUTO no PDV · Balcão (pedido do dono, 17/11/2026: "um card moderno, mais fácil de identificar o produto
// pela foto e pelo nome"): a foto do cadastro em cima, grande; o nome em destaque logo abaixo; o preço no pé. Sem foto, o
// mesmo espaço com um ícone (a grade fica alinhada). O código PDV fica pequeno sobre a foto (quem digita o código o acha);
// a quantidade já no pedido, no canto. Um toque põe no pedido (ou abre as escolhas).
export function CartaoDoProduto({ produto, qtd, aoTocar }: { produto: any; qtd: number; aoTocar: () => void }) {
  const p = produto;
  const variavel = p.tipo === 'variavel';
  return (
    <button
      type="button"
      data-produto={p.id}
      onClick={aoTocar}
      title={p.nome}
      aria-label={`${p.nome}, ${variavel ? 'a partir de ' : ''}${brl(Number(p.precoVenda))}${qtd ? `, ${qtd} no pedido` : ''}`}
      className={`group relative flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition hover:-translate-y-px hover:border-primary hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        qtd ? 'border-primary ring-1 ring-primary' : 'border-border'
      }`}
    >
      <span className="relative block aspect-[16/10] w-full overflow-hidden bg-secondary">
        {p.imagemRef ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imagemRef}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-muted-foreground/70">
            <UtensilsCrossed className="h-7 w-7" aria-hidden="true" />
          </span>
        )}
        {p.codigo && (
          <span className="absolute left-1.5 top-1.5 max-w-[70%] truncate rounded-md bg-card/90 px-1.5 py-0.5 font-mono text-[10.5px] font-semibold leading-none text-muted-foreground shadow-sm">
            {p.codigo}
          </span>
        )}
        {qtd > 0 && (
          <span className="absolute right-1.5 top-1.5 grid h-7 min-w-7 place-items-center rounded-full bg-primary px-1.5 font-mono text-sm font-bold text-primary-foreground shadow">
            {qtd}
          </span>
        )}
      </span>
      <span className="flex flex-1 flex-col gap-1.5 p-2.5">
        <span className="line-clamp-2 break-words font-display text-[0.95rem] font-extrabold leading-tight tracking-tight">{p.nome}</span>
        <span className="mt-auto flex items-end justify-between gap-2">
          <span className="font-mono text-[0.95rem] font-bold leading-tight">
            {variavel && <span className="block font-sans text-[10.5px] font-medium text-muted-foreground">a partir de</span>}
            {brl(Number(p.precoVenda))}
          </span>
          {variavel && (
            <span title="Tem tamanhos para escolher" className="grid h-6 w-6 flex-none place-items-center rounded-md border border-border bg-secondary text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** O esqueleto da grade enquanto o cardápio carrega (a mesma forma do cartão). */
export function CartaoDoProdutoCarregando() {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card" aria-hidden="true">
      <div className="aspect-[16/10] w-full animate-pulse bg-secondary motion-reduce:animate-none" />
      <div className="space-y-2 p-2.5">
        <div className="h-4 w-3/4 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
      </div>
    </div>
  );
}
