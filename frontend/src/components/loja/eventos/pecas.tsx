'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import '@/app/c/[token]/temas/eventos.css';
import type { Cardapio } from '../cardapio/use-cardapio';
import { Foto, Ic, Preco } from '../cardapio/partes';
import { ART, ovo } from './arte';
import { EVENTOS, contagemAoVivo, contagemDoEvento, textosDaFaixa, type EventoDoMenu } from './catalogo';
import { enfeiteDoTopo } from './guirlanda';
import { Particulas } from './particulas';
import type { EventoNoAr } from './contexto';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AS PEÇAS DO EVENTO SAZONAL (06-eventos-sazonais.md) — baixadas só quando há evento no ar.
// Regra de ouro: festa na vitrine, foco no checkout, festa de novo na confirmação. No checkout
// não caem partículas (só a trilha das etapas lembra o evento) e, na confirmação, a comemoração
// só começa quando o pedido está garantido — com Pix pendente, nada cai em cima do código.
//
// Tudo aqui é enfeite: nenhuma peça mexe na regra do pedido. O cupom do mini-jogo passa pelo
// mesmo `aplicarCupom` de sempre, e quem valida o desconto é o servidor.

const SUFIXO_SACOLA = ' está na sacola';

/** Arte fixa de `arte.ts` (nunca texto do usuário), como HTML pronto e fora da leitura de tela. */
function Arte({ html, className }: { html: string; className?: string }) {
  return <span className={className} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState(false);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia('(prefers-reduced-motion: reduce)');
    const ler = () => setReduzido(m.matches);
    ler();
    m.addEventListener?.('change', ler);
    return () => m.removeEventListener?.('change', ler);
  }, []);
  return reduzido;
}

// ---------- o que a raiz do cardápio precisa ----------

/** Classes da raiz: `ev-on ev-<evento>` (e `ev-parado` com as animações desligadas). */
export function classesDoEvento(ev: EventoDoMenu): string {
  return `ev-on ev-${ev.chave}${ev.animacoes ? '' : ' ev-parado'}`;
}

/** A cor de ação do evento, ou `null` para manter a cor da loja ("Cores do evento" desligado). */
export function acentoDoEvento(ev: EventoDoMenu, escuro: boolean): string | null {
  if (!ev.cores) return null;
  const def = EVENTOS[ev.chave];
  return escuro && def.accEscuro ? def.accEscuro : def.acc;
}

/** "X está na sacola" vira a frase do evento; qualquer outro aviso passa como veio. */
export function fraseDoAviso(ev: EventoDoMenu, aviso: string): string {
  if (!aviso.endsWith(SUFIXO_SACOLA)) return aviso;
  return EVENTOS[ev.chave].naSacola(aviso.slice(0, -SUFIXO_SACOLA.length));
}

/**
 * Caça aos ovos: os três produtos que escondem um ovo — um em cada terço do cardápio, sempre os
 * mesmos enquanto o cardápio não mudar (o cliente não vê o ovo trocar de lugar).
 */
export function produtosComOvo(secoes: { itens: any[] }[]): string[] {
  const comFoto = secoes.map((s) => s.itens.filter((p) => p.imagemRef && !p.esgotado)).filter((l) => l.length);
  if (comFoto.length === 0) return [];
  const ids: string[] = [];
  for (let k = 0; k < 3; k++) {
    const lista = comFoto[Math.min(comFoto.length - 1, Math.floor(((k + 0.5) * comFoto.length) / 3))];
    const p = lista.find((x) => !ids.includes(x.id)) ?? comFoto.flat().find((x) => !ids.includes(x.id));
    if (p) ids.push(p.id);
  }
  return ids;
}

const pctDesconto = (p: any) => (p?.precoDe != null && Number(p.precoDe) > 0 ? Math.round((1 - Number(p.precoVenda) / Number(p.precoDe)) * 100) : 0);

// ---------- enfeite do topo ----------

export function Topo({ e }: { e: EventoNoAr }) {
  const ref = useRef<HTMLDivElement>(null);
  const [largura, setLargura] = useState(390);
  useLayoutEffect(() => {
    const pai = ref.current?.parentElement;
    if (!pai) return;
    const medir = () => setLargura(pai.clientWidth || 390);
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const o = new ResizeObserver(medir);
    o.observe(pai);
    return () => o.disconnect();
  }, []);
  const { html, classe } = useMemo(() => enfeiteDoTopo(EVENTOS[e.evento.chave].topo, largura), [e.evento.chave, largura]);
  return <div ref={ref} className={`ev-gar ${classe}`} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />;
}

// ---------- faixa do evento + coleção ----------

/** Os produtos da coleção: os que o presidente escolheu; sem escolha, as ofertas (Black Friday) ou os destaques. */
function produtosDaColecao(c: Cardapio, ev: EventoDoMenu): any[] {
  const porId = new Map<string, any>(c.produtos.map((p: any) => [p.id, p]));
  let lista: any[] = ev.colecao.map((id) => porId.get(id)).filter((p) => p && !p.esgotado);
  if (!lista.length) lista = ev.chave === 'blackfriday' && c.produtosPromo.length ? c.produtosPromo : c.destaques;
  return lista.slice(0, 8);
}

function useContagem(ev: EventoDoMenu): string {
  const [texto, setTexto] = useState(() => contagemDoEvento(ev, new Date()));
  useEffect(() => {
    const atualizar = () => setTexto(contagemDoEvento(ev, new Date()));
    atualizar();
    const t = setInterval(atualizar, contagemAoVivo(ev.chave) ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [ev]);
  return texto;
}

/** O ponto do toque dentro da raiz do cardápio (para o estouro sair de onde o dedo está). */
function pontoNaRaiz(el: Element | null, ev: { clientX: number; clientY: number }) {
  const raiz = el?.closest('.p-root');
  const b = raiz?.getBoundingClientRect();
  return b ? { x: ev.clientX - b.left, y: ev.clientY - b.top } : { x: 160, y: 200 };
}

export function FaixaEColecao({ c, e }: { c: Cardapio; e: EventoNoAr }) {
  const ev = e.evento;
  const def = EVENTOS[ev.chave];
  const contagem = useContagem(ev);
  const colecao = useMemo(() => produtosDaColecao(c, ev), [c.produtos, c.destaques, c.produtosPromo, ev]); // eslint-disable-line react-hooks/exhaustive-deps
  const maiorDesconto = useMemo(() => c.produtosPromo.reduce((m: number, p: any) => Math.max(m, pctDesconto(p)), 0), [c.produtosPromo]);
  const { rotulo, titulo, texto } = textosDaFaixa(ev, maiorDesconto);
  const refColecao = useRef<HTMLElement>(null);
  const jogo = ev.cupomJogo ? def.jogo : undefined;
  const ovosAchados = e.jogo.ovos.length;

  function tocarAbobora(evt: MouseEvent<HTMLButtonElement>) {
    if (e.jogo.abobora || !ev.cupomJogo) return;
    // O sorteio é só do ENFEITE (qual animação aparece). O cupom é o mesmo nos dois casos: todo
    // mundo que toca ganha — não há prêmio por sorte.
    const saiu = Math.random() < 0.5 ? 'gostosura' : 'travessura';
    e.setJogo((j) => ({ ...j, abobora: saiu }));
    void c.aplicarCupom(ev.cupomJogo);
    const raiz = evt.currentTarget.closest('.p-root');
    if (saiu === 'travessura') {
      raiz?.classList.remove('ev-treme');
      void (raiz as HTMLElement | null)?.offsetWidth;
      raiz?.classList.add('ev-treme');
      e.fx.current?.morcegos(7);
      c.avisar(`Travessura! Mas o cupom ${ev.cupomJogo} é seu`);
    } else {
      e.fx.current?.estouro(['candy'], pontoNaRaiz(evt.currentTarget, evt), 34);
      c.avisar(`Gostosura! Cupom ${ev.cupomJogo} guardado para o seu pedido`);
    }
  }

  let selo = <span className="ev-chip">{contagem}</span>;
  if (jogo === 'ovos') {
    selo =
      ovosAchados >= 3 ? (
        <span className="ev-chip">Cupom {ev.cupomJogo} guardado</span>
      ) : (
        <span className="ev-chip ev-ovos" aria-label={`${ovosAchados} de 3 ovos encontrados`}>
          {[0, 1, 2].map((i) => (
            <i key={i} dangerouslySetInnerHTML={{ __html: ovo(i < ovosAchados ? '#7B4A2E' : 'rgba(123,74,46,.25)', '#fff') }} />
          ))}{' '}
          {ovosAchados} de 3
        </span>
      );
  } else if (jogo === 'abobora' && e.jogo.abobora) {
    selo = (
      <span className="ev-chip">
        {e.jogo.abobora === 'gostosura' ? 'Gostosura!' : 'Travessura!'} Cupom {ev.cupomJogo}
      </span>
    );
  }

  return (
    <>
      <section className="ev-strip" aria-label={def.nome}>
        <div className="tx">
          <small>{rotulo}</small>
          <h3>{titulo}</h3>
          <p>{texto}</p>
          <div className="row">
            {selo}
            {colecao.length > 0 && (
              <button type="button" className="ev-go" onClick={() => refColecao.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
                Ver {def.colecao.toLowerCase()} <Ic n="chev" s={13} />
              </button>
            )}
          </div>
        </div>
        {jogo === 'abobora' ? (
          <button
            type="button"
            className={`ev-art ev-pk ${e.jogo.abobora ? 'aberta' : ''}`}
            onClick={tocarAbobora}
            disabled={!!e.jogo.abobora}
            aria-label="Tocar na abóbora"
            dangerouslySetInnerHTML={{ __html: ART.hero.halloween }}
          />
        ) : (
          <Arte className="ev-art" html={ART.hero[ev.chave]} />
        )}
      </section>
      {colecao.length > 0 && (
        <section className="ev-col" ref={refColecao}>
          <h2>
            <Icone e={e} />
            {def.colecao}
          </h2>
          <div className="hs ev-row">
            {colecao.map((p, i) => (
              <button key={p.id} type="button" className="ev-ci" onClick={() => c.abrirProduto(p)}>
                <div className="a">
                  <Foto src={p.imagemRef} alt={p.nome} enfeite={i % 3 === 0} />
                  {pctDesconto(p) > 0 && <span className="ev-off">-{pctDesconto(p)}%</span>}
                </div>
                <span
                  className="pl"
                  role="button"
                  tabIndex={0}
                  aria-label={c.precisaEscolha(p) ? `Montar ${p.nome}` : `Pôr ${p.nome} na sacola`}
                  onClick={(evt) => {
                    evt.stopPropagation();
                    c.adicionarRapido(p);
                  }}
                  onKeyDown={(evt) => {
                    if (evt.key === 'Enter' || evt.key === ' ') {
                      evt.preventDefault();
                      evt.stopPropagation();
                      c.adicionarRapido(p);
                    }
                  }}
                >
                  <Ic n="plus" s={16} />
                </span>
                <b>{p.nome}</b>
                <small>
                  <Preco p={p} />
                </small>
              </button>
            ))}
          </div>
        </section>
      )}
    </>
  );
}

// ---------- ícone dos títulos, acessório das fotos e ovo escondido ----------

export function Icone({ e }: { e: EventoNoAr }) {
  return <Arte className="ev-ico" html={ART.ico[e.evento.chave]} />;
}

export function NaFoto({ e, enfeite, produtoId }: { e: EventoNoAr; enfeite: boolean; produtoId?: string }) {
  const ev = e.evento;
  const def = EVENTOS[ev.chave];
  const temOvo = !!produtoId && e.ovos.includes(produtoId) && !e.jogo.ovos.includes(produtoId);
  return (
    <>
      {enfeite && <Arte className={`ev-hat ${def.posicao} h-${ev.chave}`} html={ART.hat[def.acessorio]} />}
      {temOvo && <Ovo e={e} produtoId={produtoId as string} />}
    </>
  );
}

/** O ovo escondido na foto de um dos três produtos sorteados (`produtosComOvo`). */
function Ovo({ e, produtoId }: { e: EventoNoAr; produtoId: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const ev = e.evento;
  const cor = ['#F9A8D4', '#6EE7B7', '#FDE68A'][Math.max(0, e.ovos.indexOf(produtoId)) % 3];

  function achar(evt: MouseEvent | KeyboardEvent) {
    evt.preventDefault();
    evt.stopPropagation(); // o ovo fica dentro do botão do produto: achar o ovo não abre o produto
    if (e.jogo.ovos.includes(produtoId)) return;
    const b = ref.current?.getBoundingClientRect();
    const r = ref.current?.closest('.p-root')?.getBoundingClientRect();
    if (b && r) e.fx.current?.estouro(['egg', 'petal'], { x: b.left + b.width / 2 - r.left, y: b.top - r.top }, 26);
    const achados = e.jogo.ovos.length + 1;
    e.setJogo((j) => (j.ovos.includes(produtoId) ? j : { ...j, ovos: [...j.ovos, produtoId] }));
    if (achados >= 3 && ev.cupomJogo) {
      void e.c.aplicarCupom(ev.cupomJogo);
      e.c.avisar(`Você achou os 3 ovos! Cupom ${ev.cupomJogo} guardado para o seu pedido`);
    } else e.c.avisar(`Achou um ovo! ${achados === 2 ? 'Falta 1' : 'Faltam 2'}`);
  }

  return (
    <span
      ref={ref}
      className="ev-egg"
      role="button"
      tabIndex={0}
      aria-label="Ovo de Páscoa escondido"
      onClick={achar}
      onKeyDown={(evt) => {
        if (evt.key === 'Enter' || evt.key === ' ') achar(evt);
      }}
      dangerouslySetInnerHTML={{ __html: ovo(cor) }}
    />
  );
}

// ---------- trilha das etapas do checkout ----------

export function Trilha({ c, e }: { c: Cardapio; e: EventoNoAr }) {
  const def = EVENTOS[e.evento.chave];
  const n = c.etapas.length;
  const idx = Math.max(0, c.etapas.indexOf(c.etapaAtual as any));
  const p = n > 1 ? idx / (n - 1) : 1;
  const pos = (v: number) => `calc(13px + (100% - 26px) * ${v})`;
  if (n < 2) return null;
  return (
    <div className={`ev-trail ${def.trilha}`} aria-hidden="true">
      <i className="t" />
      <i className="f" style={{ width: pos(p) }} />
      {c.etapas.map((etapa, j) => (
        <i key={etapa} className={`m ${j <= idx ? 'on' : ''}`} style={{ left: pos(n > 1 ? j / (n - 1) : 1) }} />
      ))}
      {/* a chave reinicia o "pulo" do corredor a cada etapa */}
      <span className="r" style={{ left: pos(p) }}>
        <span key={idx} className="ev-corre" dangerouslySetInnerHTML={{ __html: ART.run[def.corredor] }} />
      </span>
    </div>
  );
}

// ---------- confirmação ----------

export function ChamadaOk({ e }: { e: EventoNoAr }) {
  return <span className="ev-kick">{EVENTOS[e.evento.chave].ok[0]}</span>;
}

export function ApoioOk({ e }: { e: EventoNoAr }) {
  return <p className="ev-oksub">{EVENTOS[e.evento.chave].ok[1]}</p>;
}

export function SeloOk({ e }: { e: EventoNoAr }) {
  return (
    <>
      <Arte html={ART.run[EVENTOS[e.evento.chave].corredor]} />
      <span className="ck">
        <Ic n="check" s={13} />
      </span>
    </>
  );
}

// ---------- partículas (um canvas por cima da tela, sem toque) ----------

/** O pedido já está garantido? (com Pix pendente, vencido ou pedido cancelado, não há festa) */
export function pedidoGarantido(ped: any, agora: number): boolean {
  if (!ped) return false;
  if (ped.status === 'cancelado') return false;
  if (ped.statusPagamento === 'aguardando') return false;
  void agora;
  return true;
}

export function Camada({ c, e }: { c: Cardapio; e: EventoNoAr }) {
  const ev = e.evento;
  const def = EVENTOS[ev.chave];
  const canvas = useRef<HTMLCanvasElement>(null);
  const reduzido = useMovimentoReduzido();
  const animar = ev.animacoes && !reduzido;
  const ultimoToque = useRef<{ x: number; y: number } | null>(null);
  const qtdAnterior = useRef(c.qtdItens);
  const comemorado = useRef<string | null>(null);
  const garantido = pedidoGarantido(c.ped, c.agora);
  // Fundo ligado: fora do checkout e, na confirmação, só com o pedido garantido.
  const fundo = animar && !c.checkoutAberto && (!c.ped || garantido);

  useEffect(() => {
    if (!animar || !canvas.current) return;
    const fx = new Particulas(canvas.current);
    e.fx.current = fx;
    const raiz = canvas.current.closest('.p-root');
    const guardar = (evt: PointerEvent) => {
      const b = raiz?.getBoundingClientRect();
      if (b) ultimoToque.current = { x: evt.clientX - b.left, y: evt.clientY - b.top };
    };
    document.addEventListener('pointerdown', guardar, true);
    return () => {
      document.removeEventListener('pointerdown', guardar, true);
      fx.destruir();
      e.fx.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animar]);

  useEffect(() => {
    if (e.fx.current) e.fx.current.escuro = c.dark;
    e.fx.current?.definir(fundo ? { particulas: def.particulas, paleta: def.paleta, fogos: def.fogos } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundo, ev.chave, c.dark, animar]);

  // Item novo na sacola: estouro de onde o dedo tocou.
  useEffect(() => {
    const antes = qtdAnterior.current;
    qtdAnterior.current = c.qtdItens;
    if (c.qtdItens > antes && animar && !c.checkoutAberto && ultimoToque.current) e.fx.current?.estouro(def.estouro, ultimoToque.current, 22, def.paleta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.qtdItens]);

  // Pedido garantido: uma comemoração por pedido (inclusive quando o Pix cai com a tela aberta).
  useEffect(() => {
    const id = c.ped ? String(c.ped.id ?? c.ped.displayId ?? 'pedido') : null;
    if (!id || !garantido || !animar || comemorado.current === id) return;
    comemorado.current = id;
    const fx = e.fx.current;
    if (!fx) return;
    const t = [
      setTimeout(() => fx.estouro(def.estouro, { x: fx.largura / 2, y: 110 }, 60, def.paleta), 200),
      ...(def.fogos ? [setTimeout(() => fx.fogos(fx.largura * 0.3, 140), 600), setTimeout(() => fx.fogos(fx.largura * 0.72, 90), 1000)] : []),
    ];
    return () => t.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.ped, garantido, animar]);

  return animar ? <canvas ref={canvas} className="ev-fx" aria-hidden="true" /> : null;
}
