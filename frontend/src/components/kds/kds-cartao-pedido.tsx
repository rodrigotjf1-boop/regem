'use client';

import { textoEntregadorDoCanal } from '@/components/delivery/logistica-canal';
import { agregarItens, corDoPedido, estaAtrasado, identPedido, proximaAcao, rotuloEtapa, type LimitesTempo } from '@/lib/kds-fila';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CARTÃO DO PEDIDO no KDS — tela neutra, a única cor é a do tempo (verde, amarelo, vermelho).
// `cor='cabecalho'`: só o cabeçalho e o botão de avanço levam a cor; `cor='inteiro'`: o cartão todo.
// Sem borda colorida e sem canto arredondado (decisão do dono, 02/10/2026). Mockup:
// `mockups/regem-kds-producao.html`.

export type TemaKds = { bg: string; panel: string; panel2: string; border: string; text: string; muted: string };
export type CorDoCartao = 'cabecalho' | 'inteiro';

// Etiqueta curta (ATRASADO, ALTERADO, OBS…): contorno na cor do texto ou "cheia" (invertida).
export function EtiquetaKds({ children, cheia, esc }: { children: React.ReactNode; cheia?: { fundo: string; texto: string }; esc: number }) {
  return (
    <span
      className="inline-block border-[1.5px] px-1.5 font-extrabold uppercase leading-normal tracking-[0.06em]"
      style={{
        fontSize: Math.round(11.5 * esc),
        borderColor: cheia ? cheia.fundo : 'currentColor',
        background: cheia?.fundo,
        color: cheia?.texto,
      }}
    >
      {children}
    </span>
  );
}

export function KdsCartaoPedido({
  p,
  min,
  limites,
  T,
  esc,
  cor,
  agregar,
  realce,
  itemEmDestaque,
  onAvancar,
}: {
  p: any;
  min: number;
  limites: LimitesTempo;
  T: TemaKds;
  esc: number;
  cor: CorDoCartao;
  agregar: boolean;
  realce: 'nenhum' | 'destaque' | 'apagado'; // item escolhido no resumo: destaca quem o leva
  itemEmDestaque: string;
  onAvancar: (id: string) => void;
}) {
  const st = corDoPedido(p, min, limites);
  const inteiro = cor === 'inteiro';
  const cancelado = p.status === 'cancelado';
  const atrasado = estaAtrasado(p, min, limites);
  const alterado = p.obs === 'ALTERADO';
  // "invertido": o par de cores que salta sobre o fundo onde está (cabeçalho × corpo).
  const invCab = { fundo: st.texto, texto: st.fundo };
  const invCorpo = inteiro ? invCab : { fundo: T.text, texto: T.panel };
  const entregador = textoEntregadorDoCanal(p.logistica);
  const origem = p.plataforma ? `${p.plataforma}${p.senhaPlataforma ? ` #${p.senhaPlataforma}` : ''}` : '';
  const linha = [cancelado ? '' : rotuloEtapa(p.status), origem].filter(Boolean).join(' · ');
  const itens: any[] = agregar ? agregarItens(p.itens ?? []) : (p.itens ?? []);
  const risco = cancelado ? 'line-through' : undefined;

  return (
    <article
      aria-label={`${identPedido(p)}, ${min} minutos, ${rotuloEtapa(p.status)}${atrasado ? ', atrasado' : ''}`}
      className="flex flex-col overflow-hidden border transition-opacity"
      style={{
        background: inteiro ? st.fundo : T.panel,
        color: inteiro ? st.texto : T.text,
        borderColor: inteiro ? 'transparent' : T.border,
        opacity: realce === 'apagado' ? 0.32 : 1,
        outline: realce === 'destaque' ? `5px solid ${T.text}` : undefined,
        outlineOffset: realce === 'destaque' ? -5 : undefined,
      }}
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
        <span
          className="whitespace-nowrap font-extrabold leading-none"
          style={{ fontFamily: 'Archivo, sans-serif', fontSize: Math.round(27 * esc), textDecoration: risco }}
        >
          {identPedido(p)}
        </span>
        <span className="whitespace-nowrap font-bold tabular-nums" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: Math.round(24 * esc) }}>
          {min}
          <small className="ml-[3px] font-bold" style={{ fontFamily: 'Figtree, sans-serif', fontSize: Math.round(13.5 * esc) }}>min</small>
        </span>
        <span className="flex basis-full flex-wrap items-center gap-x-2 gap-y-1 font-bold" style={{ fontSize: Math.round(13.5 * esc) }}>
          {linha && <span>{linha}</span>}
          {cancelado && <EtiquetaKds cheia={invCab} esc={esc}>Cancelado</EtiquetaKds>}
          {atrasado && <EtiquetaKds cheia={invCab} esc={esc}>Atrasado</EtiquetaKds>}
          {alterado && <EtiquetaKds esc={esc}>Alterado</EtiquetaKds>}
        </span>
      </div>

      <div className="flex flex-1 flex-col" style={{ padding: `${Math.round(12 * esc)}px ${Math.round(14 * esc)}px ${Math.round(14 * esc)}px` }}>
        {/* Entregador do canal (99, mig 294): quem vem buscar, se já chegou e o código de coleta. */}
        {entregador && (
          <p className="mb-2.5 font-bold" style={{ fontSize: Math.round(13.5 * esc) }}>
            {p.logistica?.status === 130 ? <EtiquetaKds cheia={invCorpo} esc={esc}>Entregador chegou</EtiquetaKds> : <EtiquetaKds esc={esc}>Entregador</EtiquetaKds>}{' '}
            {entregador}
            {p.logistica?.codigoColeta ? ` · código ${p.logistica.codigoColeta}` : ''}
          </p>
        )}
        <ul className="mb-3 grid flex-1 content-start gap-2">
          {itens.map((it: any, ix: number) => {
            const alvo = realce === 'destaque' && String(it.descricao ?? '').trim() === itemEmDestaque;
            return (
              <li
                key={it.id ?? ix}
                className="grid grid-cols-[auto_minmax(0,1fr)] gap-2 leading-snug"
                style={{ fontSize: Math.round(16 * esc), textDecoration: risco }}
              >
                <span className="min-w-[2.2ch] text-right font-bold" style={{ fontFamily: 'JetBrains Mono, monospace' }}>
                  {Number(it.quantidade)}×
                </span>
                <div>
                  <span className="font-bold" style={alvo ? { background: invCorpo.fundo, color: invCorpo.texto, padding: '0 5px' } : undefined}>
                    {it.descricao}
                  </span>
                  {it.complementosTexto && (
                    <div className="mt-0.5 font-semibold" style={{ fontSize: Math.round(13.5 * esc), color: inteiro ? 'inherit' : T.muted }}>
                      + {it.complementosTexto}
                    </div>
                  )}
                  {it.observacao && (
                    <div className="mt-1 font-extrabold" style={{ fontSize: Math.round(13.5 * esc) }}>
                      <EtiquetaKds cheia={invCorpo} esc={esc}>Obs</EtiquetaKds> {it.observacao}
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
        {!cancelado && (
          <button
            type="button"
            onClick={() => onAvancar(p.id)}
            className="w-full font-extrabold uppercase tracking-[0.08em] active:opacity-85"
            // No modo "cabeçalho" o botão tem a cor do cabeçalho; no "inteiro", invertido sobre a cor.
            style={{
              minHeight: Math.round(48 * esc),
              fontFamily: 'Archivo, sans-serif',
              fontSize: Math.round(14.5 * esc),
              background: inteiro ? st.texto : st.fundo,
              color: inteiro ? st.fundo : st.texto,
            }}
          >
            {proximaAcao(p.status)}
          </button>
        )}
      </div>
    </article>
  );
}
