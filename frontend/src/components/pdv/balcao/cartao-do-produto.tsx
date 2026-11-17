'use client';

import { SlidersHorizontal, UtensilsCrossed } from 'lucide-react';

/* eslint-disable @typescript-eslint/no-explicit-any */
const brl = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O tamanho dos cartões (preferência de cada pessoa, `pdvCartoes`): grande é o padrão. */
export type TamanhoDoCartao = 'grande' | 'compacto';
export const tamanhoDoCartao = (v: unknown): TamanhoDoCartao => (v === 'compacto' ? 'compacto' : 'grande');

/**
 * A grade dos cartões: quantas colunas couberem com a largura mínima do tamanho (sem barra para o lado em largura nenhuma).
 * Grande: 11 rem (6 por linha no monitor da loja; no celular, sempre 2); compacto: 9,5 rem.
 */
export const gradeDeProdutos = (t: TamanhoDoCartao) =>
  t === 'compacto'
    ? 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,9.5rem),1fr))] gap-2.5'
    : 'grid grid-cols-2 gap-2.5 min-[480px]:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] min-[480px]:gap-3';

// O CARTÃO DO PRODUTO no PDV · Balcão (pedido do dono, 17/11/2026: "um card moderno, mais fácil de identificar o produto
// pela foto e pelo nome"; depois: "a primeira tela parece não ter mudado" — o cartão continuava do tamanho do antigo): a
// foto do cadastro em cima, GRANDE (4:3 no tamanho grande); o nome em destaque logo abaixo (17 px, duas linhas, o espaço
// das duas guardado para a grade alinhar); o preço numa etiqueta dourada. Sem foto, o mesmo espaço com um ícone. O código
// PDV fica pequeno sobre a foto (quem digita o código o acha); a quantidade já no pedido, no canto. Um toque põe no pedido
// (ou abre as escolhas).
export function CartaoDoProduto({
  produto,
  qtd,
  aoTocar,
  tamanho = 'grande',
}: {
  produto: any;
  qtd: number;
  aoTocar: () => void;
  tamanho?: TamanhoDoCartao;
}) {
  const p = produto;
  const variavel = p.tipo === 'variavel';
  const grande = tamanho === 'grande';
  return (
    <button
      type="button"
      data-produto={p.id}
      data-tamanho={tamanho}
      onClick={aoTocar}
      title={p.nome}
      aria-label={`${p.nome}, ${variavel ? 'a partir de ' : ''}${brl(Number(p.precoVenda))}${qtd ? `, ${qtd} no pedido` : ''}`}
      className={`group relative flex min-w-0 flex-col overflow-hidden border bg-card text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none motion-reduce:hover:translate-y-0 ${
        grande ? 'rounded-2xl' : 'rounded-xl'
      } ${qtd ? 'border-primary ring-2 ring-primary' : 'border-border'}`}
    >
      <span className={`relative block w-full overflow-hidden bg-secondary ${grande ? 'aspect-[4/3]' : 'aspect-[16/10]'}`}>
        {p.imagemRef ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={p.imagemRef}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        ) : (
          <span className="grid h-full w-full place-items-center text-muted-foreground/70">
            <UtensilsCrossed className={grande ? 'h-10 w-10' : 'h-7 w-7'} aria-hidden="true" />
          </span>
        )}
        {p.codigo && (
          <span className="absolute left-2 top-2 max-w-[70%] truncate rounded-md bg-card/90 px-1.5 py-0.5 font-mono text-[11px] font-semibold leading-none text-muted-foreground shadow-sm">
            {p.codigo}
          </span>
        )}
        {qtd > 0 && (
          <span
            className={`absolute right-2 top-2 grid place-items-center rounded-full bg-primary px-1.5 font-mono font-bold text-primary-foreground shadow ${
              grande ? 'h-8 min-w-8 text-base' : 'h-7 min-w-7 text-sm'
            }`}
          >
            {qtd}
          </span>
        )}
      </span>
      <span className={`flex flex-1 flex-col ${grande ? 'gap-2 p-3' : 'gap-1.5 p-2.5'}`}>
        <span
          className={`line-clamp-2 break-words font-display font-extrabold leading-tight tracking-tight ${
            grande ? 'min-h-[2.5em] text-[1.0625rem]' : 'text-[0.95rem]'
          }`}
        >
          {p.nome}
        </span>
        <span className="mt-auto flex items-end justify-between gap-2">
          <span className="min-w-0">
            {variavel && <span className="block text-[10.5px] font-medium text-muted-foreground">a partir de</span>}
            <span
              className={`inline-block rounded-lg font-mono font-bold leading-tight ${
                grande ? 'bg-primary/15 px-2 py-1 text-base text-foreground' : 'text-[0.95rem]'
              }`}
            >
              {brl(Number(p.precoVenda))}
            </span>
          </span>
          {variavel && (
            <span title="Tem tamanhos para escolher" className="grid h-7 w-7 flex-none place-items-center rounded-md border border-border bg-secondary text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </span>
      </span>
    </button>
  );
}

/** O esqueleto da grade enquanto o cardápio carrega (a mesma forma do cartão). */
export function CartaoDoProdutoCarregando({ tamanho = 'grande' }: { tamanho?: TamanhoDoCartao }) {
  return (
    <div className={`overflow-hidden border border-border bg-card ${tamanho === 'grande' ? 'rounded-2xl' : 'rounded-xl'}`} aria-hidden="true">
      <div className={`w-full animate-pulse bg-secondary motion-reduce:animate-none ${tamanho === 'grande' ? 'aspect-[4/3]' : 'aspect-[16/10]'}`} />
      <div className="space-y-2 p-3">
        <div className="h-4 w-3/4 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
        <div className="h-5 w-1/3 animate-pulse rounded bg-secondary motion-reduce:animate-none" />
      </div>
    </div>
  );
}
