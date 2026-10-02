'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode } from 'react';
import type { Cardapio } from '../cardapio/use-cardapio';
import type { EventoChave, EventoDoMenu } from './catalogo';
import type { Particulas } from './particulas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// EVENTOS SAZONAIS NO CARDÁPIO — a parte que fica no pacote principal: quase nada. A camada de
// verdade (arte, partículas, faixa, fontes e CSS do evento) mora em `./pecas` e só é baixada quando
// o servidor diz que há evento no ar (`menu.evento`). Sem evento, o cardápio não carrega nem
// executa nada daqui: os "encaixes" abaixo devolvem `null`.
//
// Os templates não importam nada de `./pecas`. Eles só têm os encaixes (`EvTopo`, `EvFaixa`,
// `EvIcone`, `EvFoto`, `EvTrilha`…), nos pontos em que o evento pode entrar.

type Pecas = typeof import('./pecas');

const CHAVES: readonly EventoChave[] = ['reveillon', 'carnaval', 'pascoa', 'maes', 'hamburguer', 'namorados', 'junina', 'pais', 'criancas', 'halloween', 'blackfriday', 'natal', 'jogo'];

/** Estado dos mini-jogos (vale enquanto a página estiver aberta). */
export interface JogoDoEvento {
  /** Caça aos ovos: produtos em que o ovo já foi achado. */
  ovos: string[];
  /** Abóbora: o que saiu, depois do toque. */
  abobora: 'gostosura' | 'travessura' | null;
}

export interface EventoNoAr {
  evento: EventoDoMenu;
  pecas: Pecas;
  jogo: JogoDoEvento;
  setJogo: (f: (j: JogoDoEvento) => JogoDoEvento) => void;
  /** As partículas (para os estouros dos mini-jogos). */
  fx: MutableRefObject<Particulas | null>;
  /** Caça aos ovos: os três produtos que escondem um ovo (vazio sem o jogo). */
  ovos: string[];
  /** O cardápio (aviso curto e cupom do mini-jogo passam pelas funções de sempre). */
  c: Cardapio;
}

const Ctx = createContext<EventoNoAr | null>(null);
export const useEventoNoAr = () => useContext(Ctx);

/** O evento que o servidor mandou, conferido (chave conhecida e campos no formato esperado). */
function eventoValido(bruto: any): EventoDoMenu | null {
  if (!bruto || typeof bruto !== 'object' || !CHAVES.includes(bruto.chave)) return null;
  if (typeof bruto.inicio !== 'string' || typeof bruto.fim !== 'string' || typeof bruto.dia !== 'string') return null;
  if (bruto.chave === 'jogo' && !bruto.partida?.inicio) return null;
  return {
    chave: bruto.chave,
    inicio: bruto.inicio,
    fim: bruto.fim,
    dia: bruto.dia,
    titulo: typeof bruto.titulo === 'string' ? bruto.titulo : null,
    texto: typeof bruto.texto === 'string' ? bruto.texto : null,
    colecao: Array.isArray(bruto.colecao) ? bruto.colecao.filter((x: unknown) => typeof x === 'string') : [],
    cores: bruto.cores !== false,
    animacoes: bruto.animacoes !== false,
    partida: bruto.partida?.inicio ? { inicio: String(bruto.partida.inicio), fim: String(bruto.partida.fim ?? bruto.partida.inicio), chamada: bruto.partida.chamada ?? null } : null,
    cupomJogo: typeof bruto.cupomJogo === 'string' && bruto.cupomJogo ? bruto.cupomJogo : null,
    previa: bruto.previa === true,
  };
}

/**
 * A camada do evento do cardápio: `null` enquanto não há evento ou enquanto as peças não chegaram
 * (a tela aparece normal e ganha o enfeite quando ele estiver pronto — nunca espera por ele). Se o
 * download das peças falhar, o cardápio segue sem evento.
 */
export function useCamadaDoEvento(c: Cardapio): EventoNoAr | null {
  const bruto = c.menu?.evento;
  const evento = useMemo(() => eventoValido(bruto), [bruto]);
  const [pecas, setPecas] = useState<Pecas | null>(null);
  const [jogo, setJogo] = useState<JogoDoEvento>({ ovos: [], abobora: null });
  const [encerrado, setEncerrado] = useState(false);
  const fx = useRef<Particulas | null>(null);

  useEffect(() => {
    if (!evento || pecas) return;
    let vivo = true;
    import('./pecas').then((m) => { if (vivo) setPecas(m); }).catch(() => {});
    return () => { vivo = false; };
  }, [evento, pecas]);

  // Dia de jogo: o tema sai do ar sozinho quando a janela do jogo acaba, mesmo com a aba aberta.
  useEffect(() => {
    setEncerrado(false);
    if (!evento?.partida || evento.previa) return;
    const falta = Date.parse(evento.partida.fim) - Date.now();
    if (!Number.isFinite(falta)) return;
    if (falta <= 0) { setEncerrado(true); return; }
    const t = setTimeout(() => setEncerrado(true), Math.min(falta, 2_000_000_000));
    return () => clearTimeout(t);
  }, [evento]);

  const comOvos = !!pecas && !!evento?.cupomJogo && evento.chave === 'pascoa';
  const ovos = useMemo(() => (comOvos && pecas ? pecas.produtosComOvo(c.secoes as any) : []), [comOvos, pecas, c.secoes]);

  return useMemo(() => (evento && pecas && !encerrado ? { evento, pecas, jogo, setJogo, fx, ovos, c } : null), [evento, pecas, encerrado, jogo, ovos, c]);
}

export function ProvedorEvento({ valor, children }: { valor: EventoNoAr | null; children: ReactNode }) {
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

// ---------- encaixes (devolvem `null` sem evento) ----------

/** Enfeite do topo da tela (pisca-pisca, bandeirinhas, teia…). Primeiro filho da área que rola. */
export function EvTopo() {
  const e = useEventoNoAr();
  return e ? <e.pecas.Topo e={e} /> : null;
}

/** Faixa do evento e a coleção de produtos, logo abaixo do cabeçalho da vitrine. */
export function EvFaixa({ c }: { c: Cardapio }) {
  const e = useEventoNoAr();
  return e ? <e.pecas.FaixaEColecao c={c} e={e} /> : null;
}

/** Ícone do evento antes do título de uma seção. */
export function EvIcone() {
  const e = useEventoNoAr();
  return e ? <e.pecas.Icone e={e} /> : null;
}

/** Acessório na foto (1 a cada 3) e, na Páscoa, o ovo escondido. Vai DENTRO do bloco da foto. */
export function EvFoto({ enfeite, produtoId }: { enfeite?: boolean; produtoId?: string }) {
  const e = useEventoNoAr();
  return e ? <e.pecas.NaFoto e={e} enfeite={!!enfeite} produtoId={produtoId} /> : null;
}

/** Trilha das etapas do checkout, com o "corredor" do evento. */
export function EvTrilha({ c }: { c: Cardapio }) {
  const e = useEventoNoAr();
  return e ? <e.pecas.Trilha c={c} e={e} /> : null;
}

/** Confirmação do pedido: a chamada do evento acima do título (só com o pedido já garantido). */
export function EvChamadaOk({ festa }: { festa: boolean }) {
  const e = useEventoNoAr();
  return e && festa ? <e.pecas.ChamadaOk e={e} /> : null;
}

/** Confirmação do pedido: a frase de apoio do evento. */
export function EvApoioOk({ festa }: { festa: boolean }) {
  const e = useEventoNoAr();
  return e && festa ? <e.pecas.ApoioOk e={e} /> : null;
}

/** Confirmação do pedido: o selo com o corredor do evento, no lugar do ícone de "certo". */
export function EvSeloOk({ festa, padrao }: { festa: boolean; padrao: ReactNode }) {
  const e = useEventoNoAr();
  return e && festa ? <e.pecas.SeloOk e={e} /> : <>{padrao}</>;
}
