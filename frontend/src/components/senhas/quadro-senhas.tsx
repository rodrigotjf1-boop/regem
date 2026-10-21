'use client';

import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TEMA_TV, iniciais, type SenhaProntaTv, type SenhaTv, type Tamanhos } from '@/lib/tela-senhas';

/* eslint-disable @next/next/no-img-element */

// O quadro da tela de senhas (mockups/regem-kds-estacoes.html, aba "Tela de senhas"): fundo branco; no alto a logo e o
// nome da loja e o relógio; Preparando (cinza, menor) e Pronto (grande, a mais nova primeiro e em verde enquanto chama);
// no pé, onde retirar e a legenda das origens. As medidas acompanham a LARGURA da TV (unidade `cqi`) e os tamanhos dos
// ajustes multiplicam cada parte. Coluna que não cabe diz quantas senhas ficaram de fora ("+N senhas") — nunca some
// em silêncio. Usado pela TV (/senhas) e pela prévia da gaveta de ajustes.

const ORIGEM: Record<string, string> = { B: 'balcão', D: 'retirada' };

function Senha({ s, grande, chama }: { s: SenhaTv; grande: boolean; chama: boolean }) {
  const prefixo = (s.prefixo ?? '').trim();
  return (
    <span
      className={`tv-senha ${chama ? 'tv-senha-chama' : ''}`}
      style={{
        fontSize: grande ? 'calc(5.2cqi * var(--tam-pronto))' : 'calc(3.4cqi * var(--tam-prep))',
        background: grande ? (chama ? TEMA_TV.ok : TEMA_TV.fundo) : TEMA_TV.chip,
        color: grande ? (chama ? TEMA_TV.sobreOk : TEMA_TV.tinta) : TEMA_TV.fraco,
        borderColor: grande ? (chama ? TEMA_TV.ok : TEMA_TV.linha) : 'transparent',
      }}
    >
      {/* O leitor de tela lê "Senha B 118"; o desenho (prefixo pequeno colado ao número) fica escondido dele. */}
      <span className="sr-only">Senha {prefixo ? `${prefixo} ` : ''}{s.senha}</span>
      {prefixo && <small aria-hidden="true">{prefixo}</small>}
      <span aria-hidden="true">{s.senha}</span>
    </span>
  );
}

/**
 * Uma coluna: as senhas que cabem e, se faltar espaço, "+N senhas" no fim (medido depois de desenhar). Mede de novo
 * quando mudam as senhas, o tamanho da coluna (ResizeObserver) ou o TAMANHO DAS LETRAS (`escala`): letra maior cabe
 * menos senha sem a coluna mudar de tamanho.
 */
function Coluna({ titulo, cor, fundo, senhas, grande, novas, vivo, escala }: {
  titulo: string;
  cor: string;
  fundo?: string;
  senhas: SenhaTv[];
  grande: boolean;
  novas?: ReadonlySet<string>;
  vivo?: boolean;
  escala: string;
}) {
  const caixa = useRef<HTMLDivElement | null>(null);
  const [fora, setFora] = useState(0);
  const chave = `${escala}|${senhas.map((s) => s.id).join(',')}`;
  useLayoutEffect(() => {
    const el = caixa.current;
    if (!el) return;
    const medir = () => {
      const limite = el.getBoundingClientRect().bottom;
      let n = 0;
      for (const filho of Array.from(el.querySelectorAll<HTMLElement>('[data-senha]')))
        if (filho.getBoundingClientRect().bottom > limite + 1) n++;
      setFora(n);
    };
    medir();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(medir) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [chave]);
  return (
    <section className="tv-col" style={{ background: fundo }} aria-label={`${titulo}: ${senhas.length} ${senhas.length === 1 ? 'senha' : 'senhas'}`}>
      <h2 className="tv-col-titulo" style={{ color: cor }}>{titulo}</h2>
      <div ref={caixa} className="tv-senhas" aria-live={vivo ? 'polite' : undefined}>
        {senhas.length === 0 && <span className="tv-vazio" style={{ color: TEMA_TV.fraco }}>Nenhuma agora</span>}
        {senhas.map((s) => (
          <span key={s.id} data-senha>
            <Senha s={s} grande={grande} chama={!!novas?.has(s.id)} />
          </span>
        ))}
      </div>
      {fora > 0 && (
        <p className="tv-fora" style={{ color: TEMA_TV.fraco }}>
          +{fora} {fora === 1 ? 'senha' : 'senhas'}
        </p>
      )}
    </section>
  );
}

export function QuadroSenhas({ loja, tamanhos, preparando, pronto, novas, hora, aviso, previa }: {
  loja: { nome: string; logoRef: string | null; logoEmoji: string | null };
  tamanhos: Tamanhos;
  preparando: SenhaTv[];
  pronto: SenhaProntaTv[];
  /** Ids das senhas que acabaram de ficar prontas (verde, pulsando). */
  novas?: ReadonlySet<string>;
  hora: string;
  /** Faixa no pé: "sem conexão", "som pausado"… */
  aviso?: ReactNode;
  /** Na gaveta de ajustes: proporção de TV (16:9), sem aviso a leitor de tela. */
  previa?: boolean;
}) {
  const [semLogo, setSemLogo] = useState(false);
  const origens = [...new Set([...preparando, ...pronto].map((s) => (s.prefixo ?? '').trim()).filter((p) => ORIGEM[p]))].sort();
  const vars = {
    '--tam-pronto': String(tamanhos.pronto / 100),
    '--tam-prep': String(tamanhos.preparando / 100),
    '--tam-titulos': String(tamanhos.titulos / 100),
    background: TEMA_TV.fundo,
    color: TEMA_TV.tinta,
    borderColor: TEMA_TV.linha,
    aspectRatio: previa ? '16 / 9' : undefined,
  } as CSSProperties;
  return (
    <div className={`tv-quadro ${previa ? 'tv-previa' : ''}`} style={vars}>
      <header className="tv-topo" style={{ borderColor: TEMA_TV.linha }}>
        <span className="tv-loja">
          {loja.logoRef && !semLogo ? (
            <img className="tv-logo" src={loja.logoRef} alt="" onError={() => setSemLogo(true)} />
          ) : loja.logoEmoji ? (
            <span className="tv-logo tv-logo-texto" aria-hidden="true" style={{ background: TEMA_TV.chip }}>{loja.logoEmoji}</span>
          ) : (
            <span className="tv-logo tv-logo-texto" aria-hidden="true" style={{ background: TEMA_TV.marca, color: TEMA_TV.sobreOk }}>
              {iniciais(loja.nome)}
            </span>
          )}
          {previa ? <p className="tv-loja-nome">{loja.nome}</p> : <h1 className="tv-loja-nome">{loja.nome}</h1>}
        </span>
        <span className="tv-hora" style={{ color: TEMA_TV.fraco }}>{hora}</span>
      </header>
      <div className="tv-colunas" style={{ borderColor: TEMA_TV.linha }}>
        <Coluna titulo="Preparando" cor={TEMA_TV.fraco} senhas={preparando} grande={false} escala={`${tamanhos.preparando}-${tamanhos.titulos}`} />
        <Coluna
          titulo="Pronto"
          cor={TEMA_TV.ok}
          fundo={`linear-gradient(180deg, ${TEMA_TV.okSuave}, ${TEMA_TV.fundo} 60%)`}
          senhas={pronto}
          grande
          novas={novas}
          vivo={!previa}
          escala={`${tamanhos.pronto}-${tamanhos.titulos}`}
        />
      </div>
      <footer className="tv-pe" style={{ borderColor: TEMA_TV.linha, color: TEMA_TV.fraco }}>
        <span>
          Retire no balcão quando o seu número aparecer em <b style={{ color: TEMA_TV.tinta }}>PRONTO</b>
        </span>
        {aviso ? <span className="tv-aviso" style={{ color: TEMA_TV.tinta }}>{aviso}</span> : origens.length > 0 && (
          <span>{origens.map((p) => `${p} ${ORIGEM[p]}`).join(' · ')}</span>
        )}
      </footer>
      <style>{CSS_TV}</style>
    </div>
  );
}

// As medidas do protótipo (em `cqi`: % da largura da TV), multiplicadas pelos tamanhos dos ajustes.
const CSS_TV = `
.tv-quadro { container-type: inline-size; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; width: 100%;
  height: 100%; overflow: hidden; border: 1px solid; }
.tv-previa { height: auto; border-radius: 12px; box-shadow: 0 10px 30px rgba(15, 34, 48, .12); }
.tv-topo { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 1.6cqi 2.4cqi;
  border-bottom: 1px solid; min-width: 0; }
.tv-loja { display: flex; align-items: center; gap: 1.4cqi; min-width: 0; }
.tv-logo { flex: none; width: calc(6cqi * var(--tam-titulos)); height: calc(6cqi * var(--tam-titulos)); border-radius: 50%;
  object-fit: cover; }
.tv-logo-texto { display: grid; place-items: center; font-family: var(--font-display); font-weight: 800;
  font-size: calc(2.2cqi * var(--tam-titulos)); }
.tv-loja-nome { font-family: var(--font-display); font-weight: 800; font-size: calc(3cqi * var(--tam-titulos)); line-height: 1.1;
  overflow-wrap: anywhere; min-width: 0; }
.tv-hora { font-family: var(--font-mono); font-weight: 700; font-size: calc(2.4cqi * var(--tam-titulos));
  font-variant-numeric: tabular-nums; flex: none; }
.tv-colunas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); min-height: 0; }
.tv-col { padding: 1.8cqi 2.4cqi; min-width: 0; min-height: 0; display: flex; flex-direction: column; gap: 1.4cqi;
  overflow: hidden; position: relative; }
.tv-col + .tv-col { border-left: 1px solid ${TEMA_TV.linha}; }
.tv-col-titulo { font-family: var(--font-display); font-weight: 800; font-size: calc(2.6cqi * var(--tam-titulos));
  letter-spacing: .1em; text-transform: uppercase; }
.tv-senhas { display: flex; flex-wrap: wrap; gap: 1.2cqi; align-content: flex-start; min-height: 0; flex: 1; overflow: hidden; }
.tv-senha { display: inline-flex; align-items: baseline; gap: .3em; border-radius: .25em; padding: .1em .38em;
  font-family: var(--font-mono); font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; border: 2px solid; }
.tv-senha small { font-size: .5em; font-weight: 700; opacity: .8; }
.tv-senha-chama { animation: tv-chama 1s ease-in-out 3; }
@keyframes tv-chama { 50% { transform: scale(1.06); box-shadow: 0 0 0 .25em rgba(11, 122, 62, .25); } }
@media (prefers-reduced-motion: reduce) { .tv-senha-chama { animation: none; } }
.tv-vazio { font-size: calc(1.8cqi * var(--tam-titulos)); }
.tv-fora { position: absolute; right: 2.4cqi; bottom: 1cqi; font-weight: 700; font-size: calc(1.8cqi * var(--tam-titulos));
  background: ${TEMA_TV.fundo}; padding: .1em .5em; border-radius: .4em; box-shadow: 0 -0.6em 1em ${TEMA_TV.fundo}; }
.tv-pe { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: 1.1cqi 2.4cqi;
  border-top: 1px solid; font-size: calc(1.8cqi * var(--tam-titulos)); min-width: 0; }
.tv-aviso { font-weight: 700; }
`;
