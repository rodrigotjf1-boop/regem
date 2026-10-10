'use client';

import { useEffect, useRef } from 'react';

// A faixa de abas do Estoque. É a mesma em `/operacao` (onde as abas trocam a seção) e em `/fichas`
// (que é a aba "Fichas técnicas" morando em rota própria): quem está nas fichas continua vendo as
// outras abas e volta para qualquer uma com um clique.
export const ABAS_ESTOQUE = [
  { key: 'painel', label: 'Painel' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'fichas', label: 'Fichas técnicas' },
  { key: 'contagem', label: 'Contagem' },
  { key: 'compras', label: 'Pedidos' }, // pedidos de compra (a chave continua `compras`: links e `?aba=`)
  { key: 'recebimento', label: 'Recebimento' },
  { key: 'validades', label: 'Validades' },
  { key: 'etiquetas', label: 'Etiquetas' },
  { key: 'desperdicio', label: 'Desperdício' },
  { key: 'vistorias', label: 'Vistorias' },
] as const;
export type AbaEstoque = (typeof ABAS_ESTOQUE)[number]['key'];
export const ehAbaEstoque = (v: unknown): v is AbaEstoque => ABAS_ESTOQUE.some((a) => a.key === v);

export function AbasEstoque({ ativa, aoEscolher }: { ativa: AbaEstoque; aoEscolher: (aba: AbaEstoque) => void }) {
  const faixa = useRef<HTMLDivElement>(null);
  // No celular a faixa rola na horizontal: a aba ligada precisa estar à vista. Quem chega por
  // `?aba=` ou pelo atalho de outra aba cairia numa aba que não aparece. Rola só a faixa
  // (`scrollIntoView` rolaria a página junto).
  useEffect(() => {
    const f = faixa.current;
    const ligada = f?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!f || !ligada) return;
    const a = ligada.getBoundingClientRect();
    const b = f.getBoundingClientRect();
    if (a.right > b.right) f.scrollLeft += a.right - b.right + 8;
    else if (a.left < b.left) f.scrollLeft -= b.left - a.left + 8;
  }, [ativa]);

  return (
    // Quebra a linha no computador; na tela estreita desliza para o lado, sem barra de rolagem à mostra.
    <div ref={faixa} className="faixa-abas -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="Seções do estoque">
      {ABAS_ESTOQUE.map((a) => {
        const ligada = a.key === ativa;
        return (
          <button
            key={a.key}
            type="button"
            onClick={() => aoEscolher(a.key)}
            aria-pressed={ligada ? 'true' : 'false'}
            className={`min-h-10 shrink-0 whitespace-nowrap rounded-md border px-3.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              ligada
                ? 'border-primary bg-primary font-bold text-primary-foreground'
                : 'border-input bg-card font-semibold text-secondary-foreground hover:border-secondary-foreground hover:text-foreground'
            }`}
          >
            {a.label}
          </button>
        );
      })}
    </div>
  );
}
