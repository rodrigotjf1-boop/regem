'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  LETRA_MINIMA,
  TEMA_TV,
  TROCA_DE_PAGINA_MS,
  iniciais,
  paginaDaColuna,
  type SenhaProntaTv,
  type SenhaTv,
  type Tamanhos,
} from '@/lib/tela-senhas';

/* eslint-disable @next/next/no-img-element */

// O quadro da tela de senhas (mockups/regem-kds-estacoes.html, aba "Tela de senhas"; onda 2 da auditoria do KDS —
// mockups/regem-kds-cozinha.html, aba 4): fundo branco; no alto a logo e o nome da loja e o relógio; Preparando (cinza,
// menor) e Pronto (grande, a mais nova primeiro e em verde enquanto chama); no pé, onde retirar e a legenda das origens.
// • As medidas acompanham a LARGURA da TV, em px (T1): o quadro mede a própria largura e cada parte é uma fração dela
//   (`--u` = 1% da largura). Antes eram `cqi`, e TV com navegador antigo (antes do Chromium 105) mostrava a senha com 16 px.
// • Coluna cheia (T2): a letra diminui até caber todas, até 60% do tamanho dos ajustes; se nem assim couber, a coluna
//   alterna páginas a cada 8 s ("página 1 de 2"), a primeira com as mais novas. Nenhuma senha some.
// Usado pela TV (/senhas) e pela prévia da gaveta de ajustes.

const ORIGEM: Record<string, string> = { B: 'balcão', D: 'retirada' };

function Senha({ s, grande, chama }: { s: SenhaTv; grande: boolean; chama: boolean }) {
  const prefixo = (s.prefixo ?? '').trim();
  return (
    <span
      className={`tv-senha ${chama ? 'tv-senha-chama' : ''}`}
      style={{
        fontSize: grande
          ? 'calc(5.2 * var(--u) * var(--tam-pronto) * var(--fit, 1))'
          : 'calc(3.4 * var(--u) * var(--tam-prep) * var(--fit, 1))',
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

type Medida = { chave: string; fit: number; porPagina: number | null };

/**
 * Uma coluna. Mede DEPOIS de desenhar todas as senhas (antes da tela pintar): a letra que cabe (busca entre 100% e 60%)
 * e, se nem a 60% cabe, quantas cabem por página. Mede de novo quando mudam as senhas, o tamanho das letras (`escala`),
 * a largura da TV ou o tamanho da coluna (ResizeObserver).
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
  const [tamanho, setTamanho] = useState(0); // muda quando a coluna muda de tamanho: obriga a medir de novo
  const chave = `${escala}|${tamanho}|${senhas.map((s) => s.id).join(',')}`;
  const [m, setM] = useState<Medida>({ chave: '', fit: 1, porPagina: null });
  const medindo = m.chave !== chave;
  const [pagina, setPagina] = useState(0);
  const pag = paginaDaColuna(senhas, medindo ? null : m.porPagina, pagina);

  useEffect(() => {
    const el = caixa.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let antes = '';
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      const agora = `${Math.round(r.width)}x${Math.round(r.height)}`;
      if (agora !== antes) {
        antes = agora;
        setTamanho((n) => n + 1);
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (!medindo) return;
    const el = caixa.current;
    if (!el) return;
    const cabe = () => el.scrollHeight <= el.clientHeight + 1 && el.scrollWidth <= el.clientWidth + 1;
    const usar = (f: number) => el.style.setProperty('--fit', String(f));
    let fit = 1;
    usar(1);
    if (!cabe()) {
      usar(LETRA_MINIMA);
      if (cabe()) {
        let lo = LETRA_MINIMA;
        let hi = 1;
        for (let i = 0; i < 10; i++) {
          const meio = (lo + hi) / 2;
          usar(meio);
          if (cabe()) lo = meio;
          else hi = meio;
        }
        fit = lo;
      } else {
        fit = LETRA_MINIMA;
      }
    }
    usar(fit);
    let porPagina: number | null = null;
    if (!cabe()) {
      // Nem a 60% cabe: quantas cabem por página (escondendo o resto só para medir).
      const chips = Array.from(el.querySelectorAll<HTMLElement>('[data-senha]'));
      let cap = chips.length;
      while (cap > 1) {
        chips.forEach((c, i) => (c.style.display = i < cap ? '' : 'none'));
        if (cabe()) break;
        cap -= 1;
      }
      chips.forEach((c) => (c.style.display = ''));
      porPagina = cap;
    }
    setM({ chave, fit, porPagina });
  }, [medindo, chave]);

  // Páginas: a cada 8 s a próxima; senha nova (que chama) volta para a primeira, onde ela está.
  const temPaginas = pag.paginas > 1;
  useEffect(() => {
    if (!temPaginas) {
      setPagina(0);
      return;
    }
    const t = setInterval(() => setPagina((p) => p + 1), TROCA_DE_PAGINA_MS);
    return () => clearInterval(t);
  }, [temPaginas]);
  const chaveDasNovas = novas ? [...novas].sort().join(',') : '';
  useEffect(() => {
    if (chaveDasNovas) setPagina(0);
  }, [chaveDasNovas]);

  return (
    <section className="tv-col" style={{ background: fundo }} aria-label={`${titulo}: ${senhas.length} ${senhas.length === 1 ? 'senha' : 'senhas'}`}>
      <h2 className="tv-col-titulo" style={{ color: cor }}>
        {titulo}
        {temPaginas && (
          <small className="tv-pagina" style={{ color: TEMA_TV.fraco }}>
            {' '}
            página {pag.atual + 1} de {pag.paginas}
          </small>
        )}
      </h2>
      <div
        ref={caixa}
        className="tv-senhas"
        aria-live={vivo ? 'polite' : undefined}
        style={medindo ? undefined : ({ '--fit': String(m.fit) } as CSSProperties)}
        data-fit={medindo ? undefined : m.fit.toFixed(2)}
        data-paginas={pag.paginas}
      >
        {senhas.length === 0 && <span className="tv-vazio" style={{ color: TEMA_TV.fraco }}>Nenhuma agora</span>}
        {pag.itens.map((s) => (
          <span key={s.id} data-senha>
            <Senha s={s} grande={grande} chama={!!novas?.has(s.id)} />
          </span>
        ))}
      </div>
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
  // A largura do quadro, em px (T1): `--u` = 1% dela. Até medir, vale 1% da janela (a TV ocupa a janela inteira).
  const quadro = useRef<HTMLDivElement | null>(null);
  const [largura, setLargura] = useState(0);
  useLayoutEffect(() => {
    const el = quadro.current;
    if (!el) return;
    const medir = () => setLargura(Math.round(el.getBoundingClientRect().width));
    medir();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', medir);
      return () => window.removeEventListener('resize', medir);
    }
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const origens = [...new Set([...preparando, ...pronto].map((s) => (s.prefixo ?? '').trim()).filter((p) => ORIGEM[p]))].sort();
  const vars = {
    '--u': largura > 0 ? `${largura / 100}px` : '1vw',
    '--tam-pronto': String(tamanhos.pronto / 100),
    '--tam-prep': String(tamanhos.preparando / 100),
    '--tam-titulos': String(tamanhos.titulos / 100),
    background: TEMA_TV.fundo,
    color: TEMA_TV.tinta,
    borderColor: TEMA_TV.linha,
    aspectRatio: previa ? '16 / 9' : undefined,
  } as CSSProperties;
  return (
    <div ref={quadro} className={`tv-quadro ${previa ? 'tv-previa' : ''}`} style={vars}>
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
        <Coluna titulo="Preparando" cor={TEMA_TV.fraco} senhas={preparando} grande={false} escala={`${tamanhos.preparando}-${tamanhos.titulos}-${largura}`} />
        <Coluna
          titulo="Pronto"
          cor={TEMA_TV.ok}
          fundo={`linear-gradient(180deg, ${TEMA_TV.okSuave}, ${TEMA_TV.fundo} 60%)`}
          senhas={pronto}
          grande
          novas={novas}
          vivo={!previa}
          escala={`${tamanhos.pronto}-${tamanhos.titulos}-${largura}`}
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

// As medidas do protótipo, em fração da LARGURA da TV (`--u` = 1% dela, em px — T1), multiplicadas pelos tamanhos dos
// ajustes. Nada de `cqi`, `max()` nem `clamp()`: navegador de TV antigo não os lê.
const CSS_TV = `
.tv-quadro { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; width: 100%;
  height: 100%; overflow: hidden; border: 1px solid; }
.tv-previa { height: auto; border-radius: 12px; box-shadow: 0 10px 30px rgba(15, 34, 48, .12); }
.tv-topo { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: calc(1.6 * var(--u)) calc(2.4 * var(--u));
  border-bottom: 1px solid; min-width: 0; }
.tv-loja { display: flex; align-items: center; gap: calc(1.4 * var(--u)); min-width: 0; }
.tv-logo { flex: none; width: calc(6 * var(--u) * var(--tam-titulos)); height: calc(6 * var(--u) * var(--tam-titulos)); border-radius: 50%;
  object-fit: cover; }
.tv-logo-texto { display: grid; place-items: center; font-family: var(--font-display); font-weight: 800;
  font-size: calc(2.2 * var(--u) * var(--tam-titulos)); }
.tv-loja-nome { font-family: var(--font-display); font-weight: 800; font-size: calc(3 * var(--u) * var(--tam-titulos)); line-height: 1.1;
  overflow-wrap: anywhere; min-width: 0; }
.tv-hora { font-family: var(--font-mono); font-weight: 700; font-size: calc(2.4 * var(--u) * var(--tam-titulos));
  font-variant-numeric: tabular-nums; flex: none; }
.tv-colunas { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.35fr); min-height: 0; }
.tv-col { padding: calc(1.8 * var(--u)) calc(2.4 * var(--u)); min-width: 0; min-height: 0; display: flex; flex-direction: column;
  gap: calc(1.4 * var(--u)); overflow: hidden; position: relative; }
.tv-col + .tv-col { border-left: 1px solid ${TEMA_TV.linha}; }
.tv-col-titulo { font-family: var(--font-display); font-weight: 800; font-size: calc(2.6 * var(--u) * var(--tam-titulos));
  letter-spacing: .1em; text-transform: uppercase; }
.tv-pagina { font-family: var(--font-body, inherit); font-weight: 700; font-size: .55em; letter-spacing: .04em; text-transform: none; }
.tv-senhas { display: flex; flex-wrap: wrap; gap: calc(1.2 * var(--u)); align-content: flex-start; min-height: 0; flex: 1; overflow: hidden; }
.tv-senha { display: inline-flex; align-items: baseline; gap: .3em; border-radius: .25em; padding: .1em .38em;
  font-family: var(--font-mono); font-weight: 700; line-height: 1.05; font-variant-numeric: tabular-nums; border: 2px solid; }
.tv-senha small { font-size: .5em; font-weight: 700; opacity: .8; }
.tv-senha-chama { animation: tv-chama 1s ease-in-out 3; }
@keyframes tv-chama { 50% { transform: scale(1.06); box-shadow: 0 0 0 .25em rgba(11, 122, 62, .25); } }
@media (prefers-reduced-motion: reduce) { .tv-senha-chama { animation: none; } }
.tv-vazio { font-size: calc(1.8 * var(--u) * var(--tam-titulos)); }
.tv-pe { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; padding: calc(1.1 * var(--u)) calc(2.4 * var(--u));
  border-top: 1px solid; font-size: calc(1.8 * var(--u) * var(--tam-titulos)); min-width: 0; }
.tv-aviso { font-weight: 700; }
`;
