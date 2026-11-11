'use client';

import { faixaTempo, identPedido, itemTirado, linhasDasEscolhas, rotuloEtapa, type GrupoDeItem, type LimitesTempo } from '@/lib/kds-fila';
import { EtiquetaKds } from './kds-cartao-pedido';

// CARTÃO DO ITEM — visão "Por item" do KDS: um cartão por item, com a soma no título e, dentro, os pedidos que o levam
// (do mais antigo para o mais novo). Versão 2 (onda 2 da auditoria, 11/11/2026): neutro, com a cor só no selo do tempo do
// pedido mais antigo. Sem botão de avanço: no Regem quem avança é o PEDIDO (senha pelo teclado ou a visão "Por pedido").

const CLASSE_FAIXA = { ok: 't-ok', atencao: 't-warn', atrasado: 't-late' } as const;

export function KdsCartaoItem({ g, limites }: { g: GrupoDeItem; limites: LimitesTempo }) {
  // O pedido que só tirou o item (alteração, mig 362) não conta como "pedido que leva".
  const nPedidos = new Set(g.linhas.filter((l) => !itemTirado(l.item)).map((l) => l.pedido.id)).size;

  return (
    <article
      className={`k-card ${CLASSE_FAIXA[faixaTempo(g.minMaisAntigo, limites)]}`}
      aria-label={`${g.descricao}, ${g.quantidade} no total, pedido mais antigo há ${g.minMaisAntigo} minutos`}
    >
      <div className="k-cab">
        <span className="k-ident">
          <span style={{ fontFamily: 'var(--fm)' }}>{g.quantidade}×</span> {g.descricao}
        </span>
        <span className="k-tempo">
          {g.minMaisAntigo}
          <small>min</small>
        </span>
        <span className="k-sub">
          em {nPedidos} pedido{nPedidos === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="k-itens k-cc">
        {g.linhas.map((l, ix) => {
          // Pedido alterado (mig 362): o item que entrou leva NOVO; o que saiu fica riscado com TIRAR até o "Visto".
          const tirar = itemTirado(l.item);
          const novo = l.item.status === 'novo';
          const comp = linhasDasEscolhas(l.item.complementosTexto);
          return (
            <li key={`${l.pedido.id}-${ix}`} className={`k-it${tirar ? ' tirar' : ''}`} data-kds-item={tirar ? 'tirar' : novo ? 'novo' : undefined}>
              <span className="k-q">{Number(l.item.quantidade)}×</span>
              <div>
                <span className="k-d">{identPedido(l.pedido)}</span>{' '}
                <span className="k-mini">
                  {l.min} min · {rotuloEtapa(l.pedido.status)}
                </span>
                {novo && (
                  <>
                    {' '}
                    <EtiquetaKds tipo="cheia">Novo</EtiquetaKds>
                  </>
                )}
                {tirar && (
                  <>
                    {' '}
                    <EtiquetaKds tipo="cheia">Tirar</EtiquetaKds>
                  </>
                )}
                {l.pedido.consumo === 'viagem' && (
                  <>
                    {' '}
                    <EtiquetaKds>Viagem</EtiquetaKds>
                  </>
                )}
                {comp.length > 0 && (
                  <ul className="k-comp">
                    {comp.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
                {l.item.observacao && (
                  <p className="k-obs">
                    <EtiquetaKds tipo="cheia">Obs</EtiquetaKds> {l.item.observacao}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </article>
  );
}
