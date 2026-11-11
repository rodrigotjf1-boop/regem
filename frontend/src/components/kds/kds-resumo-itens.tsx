'use client';

import type { ItemDoResumo } from '@/lib/kds-fila';

// RESUMO DE ITENS do KDS — a soma do que falta produzir em todos os pedidos da tela. Tocar num item destaca os pedidos que
// o levam. Ao lado da fila a partir de 900 px (no tablet deitado também); abaixo disso, embaixo da fila, empurrando-a para
// cima — nunca cobre o rodapé nem os últimos cartões (auditoria do KDS, 11/11/2026, L7). Desenho em app/kds/kds-tela.css.

export function KdsResumoItens({
  itens,
  escolhido,
  onEscolher,
  onFechar,
}: {
  itens: ItemDoResumo[];
  escolhido: string;
  onEscolher: (descricao: string) => void;
  onFechar: () => void;
}) {
  return (
    <aside id="kds-resumo" className="k-resumo" aria-label="Resumo de itens a produzir">
      <h2>
        Resumo de itens
        <button type="button" className="k-x" onClick={onFechar} aria-label="Fechar o resumo">
          ✕
        </button>
      </h2>
      <p>O que falta produzir, somado. Toque num item para destacar os pedidos que o levam.</p>
      <ul className="k-res-lista">
        {itens.length === 0 ? (
          <li className="k-nota">Nada a produzir agora.</li>
        ) : (
          itens.map((it) => {
            const ativo = escolhido === it.descricao;
            return (
              <li key={it.descricao}>
                <button type="button" className="k-res-it" aria-pressed={ativo} onClick={() => onEscolher(ativo ? '' : it.descricao)}>
                  <span className="n">{it.quantidade}</span>
                  <span className="t">
                    {it.descricao}
                    <span className="s">
                      em {it.pedidos} pedido{it.pedidos === 1 ? '' : 's'}
                    </span>
                  </span>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </aside>
  );
}
