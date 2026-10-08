'use client';

import { useEffect, useRef } from 'react';

// Faixa de PARTES de uma tela que tem mais de uma lista ou grupo de ajustes (ex.: Produção & KDS →
// "Ajustes do KDS" e "Destino por setor"). Cada parte mostra a quantidade do que ela tem. Mesmo
// desenho da faixa de abas do Estoque: quebra a linha no computador; na tela estreita desliza para
// o lado sem barra de rolagem à mostra (`.faixa-abas`, em globals.css).
export function Partes<K extends string>({
  partes,
  ativa,
  aoEscolher,
  rotulo,
}: {
  partes: { key: K; label: string; conta?: number | null }[];
  ativa: K;
  aoEscolher: (parte: K) => void;
  /** Nome do grupo para leitor de tela ("Partes de Produção & KDS"). */
  rotulo: string;
}) {
  // Na tela estreita a faixa desliza: a parte aberta (por um link, por exemplo) não pode ficar
  // escondida fora da faixa. Só a própria faixa é rolada — a página não se mexe.
  const faixa = useRef<HTMLDivElement>(null);
  // As quantidades chegam depois e alargam as partes: confere de novo quando elas mudam.
  const largura = partes.map((p) => `${p.key}:${p.conta ?? ''}`).join('|');
  useEffect(() => {
    const el = faixa.current;
    const botao = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !botao || el.scrollWidth <= el.clientWidth) return;
    const ini = botao.offsetLeft - el.offsetLeft;
    if (ini < el.scrollLeft || ini + botao.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = Math.max(0, ini - 16);
  }, [ativa, largura]);
  return (
    <div ref={faixa} className="faixa-abas -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label={rotulo}>
      {partes.map((p) => {
        const ligada = p.key === ativa;
        return (
          <button
            key={p.key}
            type="button"
            onClick={() => aoEscolher(p.key)}
            aria-pressed={ligada ? 'true' : 'false'}
            className={`inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border px-3.5 py-1.5 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
              ligada
                ? 'border-primary bg-primary font-bold text-primary-foreground'
                : 'border-input bg-card font-semibold text-secondary-foreground hover:border-secondary-foreground hover:text-foreground'
            }`}
          >
            {/* O espaço não aparece (os dois são itens do flex), mas separa o nome da quantidade para o leitor de tela. */}
            {p.label}{' '}
            {p.conta != null && (
              <span className={`rounded-full px-2 py-px font-mono text-xs ${ligada ? 'bg-primary-foreground/15' : 'bg-secondary text-foreground'}`}>{p.conta}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
