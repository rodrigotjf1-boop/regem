'use client';

import type { ItemDoResumo } from '@/lib/kds-fila';
import type { TemaKds } from './kds-cartao-pedido';

// RESUMO DE ITENS do KDS — a soma do que falta produzir em todos os pedidos da tela. Tocar num item
// destaca os pedidos que o levam. Ao lado da grade em tela larga; folha por cima em tela estreita.

export function KdsResumoItens({
  itens,
  escolhido,
  onEscolher,
  onFechar,
  T,
}: {
  itens: ItemDoResumo[];
  escolhido: string;
  onEscolher: (descricao: string) => void;
  onFechar: () => void;
  T: TemaKds;
}) {
  return (
    <aside
      id="kds-resumo"
      aria-label="Resumo de itens a produzir"
      className="fixed inset-x-0 bottom-0 z-[25] max-h-[62dvh] overflow-y-auto border p-3.5 shadow-2xl xl:sticky xl:inset-x-auto xl:bottom-auto xl:top-[150px] xl:z-auto xl:max-h-[calc(100dvh-170px)] xl:self-start xl:shadow-none"
      style={{ background: T.panel, borderColor: T.border, color: T.text }}
    >
      <h2 className="mb-1 flex items-center justify-between gap-2 text-[12px] font-bold uppercase tracking-[0.14em]" style={{ color: T.muted, fontFamily: 'Archivo, sans-serif' }}>
        Resumo de itens
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar o resumo"
          className="grid h-11 w-11 place-items-center border text-[15px] xl:hidden"
          style={{ background: T.panel2, borderColor: T.border, color: T.text }}
        >
          ✕
        </button>
      </h2>
      <p className="mb-2.5 text-[12px]" style={{ color: T.muted }}>
        O que falta produzir, somado de todos os pedidos. Toque num item para destacar os pedidos que o levam.
      </p>
      {itens.length === 0 ? (
        <p className="text-[13px]" style={{ color: T.muted }}>Nada a produzir agora.</p>
      ) : (
        <ul className="grid gap-1.5">
          {itens.map((it) => {
            const ativo = escolhido === it.descricao;
            return (
              <li key={it.descricao}>
                <button
                  type="button"
                  aria-pressed={ativo}
                  onClick={() => onEscolher(ativo ? '' : it.descricao)}
                  className="grid min-h-[48px] w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-2.5 border px-2.5 py-1.5 text-left"
                  style={{ background: ativo ? T.text : T.panel2, borderColor: ativo ? T.text : T.border, color: ativo ? T.panel : T.text }}
                >
                  <span className="min-w-[2.4ch] text-right text-[20px] font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                    {it.quantidade}
                  </span>
                  <span className="text-[14px] font-bold leading-tight">
                    {it.descricao}
                    <span className="block text-[11.5px] font-semibold" style={{ color: ativo ? T.panel : T.muted }}>
                      em {it.pedidos} pedido{it.pedidos === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}
