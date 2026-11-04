'use client';

import { COR_STATUS, faixaTempo, identPedido, itemTirado, rotuloEtapa, type GrupoDeItem, type LimitesTempo } from '@/lib/kds-fila';
import { EtiquetaKds, type CorDoCartao, type TemaKds } from './kds-cartao-pedido';

// CARTÃO DO ITEM — visão "Por item" do KDS: um cartão por item, com a soma no título e, dentro, os
// pedidos que o levam (do mais antigo para o mais novo). A cor é a do pedido mais antigo com o item.
// Sem botão de avanço: no Regem quem avança é o PEDIDO (senha pelo teclado ou a visão "Por pedido").

export function KdsCartaoItem({ g, limites, T, esc, cor }: { g: GrupoDeItem; limites: LimitesTempo; T: TemaKds; esc: number; cor: CorDoCartao }) {
  const st = COR_STATUS[faixaTempo(g.minMaisAntigo, limites)];
  const inteiro = cor === 'inteiro';
  const inv = inteiro ? { fundo: st.texto, texto: st.fundo } : { fundo: T.text, texto: T.panel };
  // O pedido que só tirou o item (alteração, mig 362) não conta como "pedido que leva".
  const nPedidos = new Set(g.linhas.filter((l) => !itemTirado(l.item)).map((l) => l.pedido.id)).size;

  return (
    <article
      aria-label={`${g.descricao}, ${g.quantidade} no total, pedido mais antigo há ${g.minMaisAntigo} minutos`}
      className="flex flex-col overflow-hidden border"
      style={{ background: inteiro ? st.fundo : T.panel, color: inteiro ? st.texto : T.text, borderColor: inteiro ? 'transparent' : T.border }}
    >
      <div
        className="flex flex-wrap items-baseline justify-between gap-x-2.5 gap-y-1"
        style={{
          background: inteiro ? 'transparent' : st.fundo,
          color: st.texto,
          padding: `${Math.round(11 * esc)}px ${Math.round(14 * esc)}px`,
          borderBottom: inteiro ? `1.5px solid ${st.texto}59` : undefined,
        }}
      >
        <span className="min-w-0 flex-1 font-extrabold" style={{ fontFamily: 'Archivo, sans-serif', fontSize: Math.round(22 * esc), lineHeight: 1.12 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace' }}>{g.quantidade}×</span> {g.descricao}
        </span>
        <span className="whitespace-nowrap font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: Math.round(24 * esc) }}>
          {g.minMaisAntigo}
          <small className="ml-[3px] font-bold" style={{ fontFamily: 'Figtree, sans-serif', fontSize: Math.round(13.5 * esc) }}>min</small>
        </span>
        <span className="basis-full font-bold" style={{ fontSize: Math.round(13.5 * esc) }}>
          em {nPedidos} pedido{nPedidos === 1 ? '' : 's'}
        </span>
      </div>

      <ul className="grid flex-1 content-start gap-2" style={{ padding: `${Math.round(12 * esc)}px ${Math.round(14 * esc)}px ${Math.round(14 * esc)}px` }}>
        {g.linhas.map((l, ix) => {
          // Pedido alterado (mig 362): o item que entrou leva NOVO; o que saiu fica riscado com TIRAR até o "Visto".
          const tirar = itemTirado(l.item);
          const novo = l.item.status === 'novo';
          return (
          <li
            key={`${l.pedido.id}-${ix}`}
            className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 leading-snug"
            style={{ fontSize: Math.round(16 * esc), textDecoration: tirar ? 'line-through' : undefined }}
            data-kds-item={tirar ? 'tirar' : novo ? 'novo' : undefined}
          >
            <span className="min-w-[2.2ch] text-right font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
              {Number(l.item.quantidade)}×
            </span>
            <div>
              <span className="font-bold">{identPedido(l.pedido)}</span>{' '}
              <span className="whitespace-nowrap font-semibold" style={{ fontSize: Math.round(13 * esc), color: inteiro ? 'inherit' : T.muted }}>
                {l.min} min · {rotuloEtapa(l.pedido.status)}
              </span>
              {novo && <> <EtiquetaKds cheia={inv} esc={esc}>Novo</EtiquetaKds></>}
              {tirar && <> <EtiquetaKds cheia={inv} esc={esc}>Tirar</EtiquetaKds></>}
              {l.pedido.consumo === 'viagem' && <> <EtiquetaKds esc={esc}>Viagem</EtiquetaKds></>}
              {l.item.complementosTexto && (
                <div className="mt-0.5 font-semibold" style={{ fontSize: Math.round(13.5 * esc), color: inteiro ? 'inherit' : T.muted }}>
                  + {l.item.complementosTexto}
                </div>
              )}
              {l.item.observacao && (
                <div className="mt-1 font-extrabold" style={{ fontSize: Math.round(13.5 * esc) }}>
                  <EtiquetaKds cheia={inv} esc={esc}>Obs</EtiquetaKds> {l.item.observacao}
                </div>
              )}
            </div>
          </li>
          );
        })}
      </ul>
    </article>
  );
}
