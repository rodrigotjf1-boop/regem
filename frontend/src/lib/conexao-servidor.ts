'use client';

import { useSyncExternalStore } from 'react';
import { api, getToken, medirServidor } from '@/lib/api';

// CONEXÃO PC ↔ SERVIDOR DA LOJA (parte 1b — protótipo aprovado em 20/10/2026, mockups/regem-conexao-servidor.html
// peça 2). UMA medição para a tela inteira: o indicador "Servidor da loja", o aviso de queda e o status do PDV e
// do garçom leem daqui (antes cada um pingava sozinho). A cada 8 s mede o servidor (respondeu? em quanto tempo?);
// a cada 30 s, no modo local e com sessão, avisa a presença deste PC — com o terminal pareado, o PC aparece
// "conectado agora" em Equipamentos. Começa com o primeiro componente que a usa e para com o último.

const EDGE = process.env.NEXT_PUBLIC_EDGE === '1';
// No modo local, 8 s (o aviso de queda sempre foi assim); na nuvem só o status do PDV/garçom usa, a cada 12 s.
export const PING_MS = EDGE ? 8000 : 12_000;
export const PRESENCA_MS = 30_000;
/** Respondeu, mas devagar: o indicador fica amarelo. */
export const LENTO_MS = 2500;
/** Duas falhas seguidas (~10 s) = sem servidor de verdade; uma só pode ser um piscar da rede. */
export const FALHAS_PARA_CAIR = 2;

export type FaseConexao = 'verificando' | 'ok' | 'lento' | 'caiu';

export type ConexaoServidor = {
  fase: FaseConexao;
  /** Quando o servidor respondeu pela última vez (ms desde 1970). */
  respondeuEm: number | null;
  latenciaMs: number | null;
  falhasSeguidas: number;
  semRespostaDesde: number | null;
  versao: string | null;
  /** O que a presença devolve (só no modo local, com sessão). */
  servidor: { nome: string; ip: string | null; maquina: string | null; versao: string | null } | null;
  pc: { ip: string | null; endereco: string | null } | null;
  terminal: { id: string; nome: string; tipo: string } | null;
};

const INICIAL: ConexaoServidor = {
  fase: 'verificando',
  respondeuEm: null,
  latenciaMs: null,
  falhasSeguidas: 0,
  semRespostaDesde: null,
  versao: null,
  servidor: null,
  pc: null,
  terminal: null,
};

let estado: ConexaoServidor = INICIAL;
const ouvintes = new Set<() => void>();
let tPing: ReturnType<typeof setInterval> | null = null;
let tPresenca: ReturnType<typeof setInterval> | null = null;
let medindo = false;

function mudar(parcial: Partial<ConexaoServidor>) {
  estado = { ...estado, ...parcial };
  for (const f of ouvintes) f();
}

/** A fase depois de uma medição: respondeu (rápido ou devagar) ou mais uma falha. */
export function faseDepois(antes: ConexaoServidor, r: { ok: boolean; ms: number | null }): Partial<ConexaoServidor> {
  if (r.ok) {
    return {
      fase: (r.ms ?? 0) >= LENTO_MS ? 'lento' : 'ok',
      respondeuEm: Date.now(),
      latenciaMs: r.ms,
      falhasSeguidas: 0,
      semRespostaDesde: null,
    };
  }
  const falhas = antes.falhasSeguidas + 1;
  return {
    falhasSeguidas: falhas,
    semRespostaDesde: antes.semRespostaDesde ?? Date.now(),
    // Uma falha depois de responder é "lento" (pode ser um piscar); a segunda derruba.
    fase: falhas >= FALHAS_PARA_CAIR ? 'caiu' : antes.fase === 'verificando' ? 'verificando' : 'lento',
  };
}

async function medir(): Promise<{ ok: boolean; ms: number | null }> {
  if (medindo) return { ok: estado.fase === 'ok' || estado.fase === 'lento', ms: estado.latenciaMs };
  medindo = true;
  try {
    const r = await medirServidor();
    mudar({ ...faseDepois(estado, r), ...(r.versao ? { versao: r.versao } : {}) });
    return r;
  } finally {
    medindo = false;
  }
}

async function avisarPresenca() {
  if (!EDGE || !getToken()) return;
  try {
    const r: any = await api.edgePresenca();
    mudar({ servidor: r?.servidor ?? null, pc: r?.pc ?? null, terminal: r?.terminal ?? null });
  } catch {
    /* a medição já mostra a queda; servidor antigo sem a rota: o indicador segue sem o detalhe */
  }
}

const aoVoltar = () => {
  void medir();
};

function iniciar() {
  if (tPing) return;
  void medir();
  tPing = setInterval(() => void medir(), PING_MS);
  if (EDGE) {
    void avisarPresenca();
    tPresenca = setInterval(() => void avisarPresenca(), PRESENCA_MS);
  }
  window.addEventListener('online', aoVoltar);
  window.addEventListener('focus', aoVoltar);
}

function parar() {
  if (tPing) clearInterval(tPing);
  if (tPresenca) clearInterval(tPresenca);
  tPing = null;
  tPresenca = null;
  window.removeEventListener('online', aoVoltar);
  window.removeEventListener('focus', aoVoltar);
}

function assinar(f: () => void) {
  ouvintes.add(f);
  if (ouvintes.size === 1) iniciar();
  return () => {
    ouvintes.delete(f);
    if (!ouvintes.size) parar();
  };
}

/** A conexão com o servidor, para qualquer componente (todos leem a mesma medição). */
export function useConexaoServidor(): ConexaoServidor {
  return useSyncExternalStore(assinar, () => estado, () => INICIAL);
}

/** "Testar agora": mede na hora (e atualiza todo mundo). */
export function testarServidorAgora(): Promise<{ ok: boolean; ms: number | null }> {
  return medir();
}
