'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { connectAsGestor, type Socket } from '@/lib/rt';
import { lerTotemAPagar, precisaBipar, type DadosTotemAPagar } from '@/lib/totem-a-pagar';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A LEITURA dos pedidos do totem em dinheiro sem pagar, UMA por aba: o ícone do topo, o do PDV e a faixa usam a mesma
// (nada de três perguntas ao servidor a cada volta). Relê:
//   • a cada 15 s com a aba à vista, e ao voltar o foco;
//   • quando a cozinha marca um cartão PRONTO (o tempo real `producao:atualizado`) — 1,5 s depois, o tempo de o pedido
//     subir para "pronto" no servidor: é o "pronto e não pago" que o atendimento precisa saber na hora;
//   • quando a Retirada vê a lista do totem mudar (pagou, cancelou) — `avisarTotemMudou()`.
// Sem permissão (403) ou servidor sem a rota (404): para de perguntar, em silêncio.
export const EVENTO_TOTEM_MUDOU = 'regem:totem-a-pagar';
const INTERVALO_MS = 15_000;
const DEPOIS_DO_PRONTO_MS = 1_500;

const VAZIO: DadosTotemAPagar = { pedidos: [], aposPagamento: null, minutos: 8 };
let estado: DadosTotemAPagar = VAZIO;
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

let usuarios = 0;
let desistiu = false;
let lendo: Promise<void> | null = null;
let relogio: ReturnType<typeof setInterval> | null = null;
let socket: Socket | null = null;
const vistos = new Set<string>();
const prontosVistos = new Set<string>();

// Dois toques curtos (Web Audio). O navegador só toca depois de alguma interação com a página — no PDV o operador está
// sempre clicando; se ainda não puder, fica o ícone e a faixa.
function bip() {
  try {
    const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AC();
    for (const [inicio, freq] of [[0, 880], [0.22, 660]] as const) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g);
      g.connect(ctx.destination);
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.2, ctx.currentTime + inicio);
      g.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + inicio + 0.18);
      o.start(ctx.currentTime + inicio);
      o.stop(ctx.currentTime + inicio + 0.2);
    }
    setTimeout(() => ctx.close?.(), 700);
  } catch {
    /* silencioso */
  }
}

function reler(): Promise<void> {
  if (desistiu || !usuarios || document.visibilityState === 'hidden') return Promise.resolve();
  if (lendo) return lendo;
  lendo = (async () => {
    try {
      const novo = lerTotemAPagar(await api.totemAguardandoPagamento());
      if (!usuarios) return;
      if (precisaBipar(vistos, prontosVistos, novo.pedidos)) bip();
      estado = novo;
      avisar();
    } catch (e) {
      const st = (e as any)?.status;
      if (st === 403 || st === 404) {
        desistiu = true;
        estado = VAZIO;
        avisar();
      }
    } finally {
      lendo = null;
    }
  })();
  return lendo;
}

const aoFocar = () => void reler();
const aoMudar = () => void reler();

function iniciar() {
  void reler();
  relogio = setInterval(() => void reler(), INTERVALO_MS);
  window.addEventListener('focus', aoFocar);
  window.addEventListener(EVENTO_TOTEM_MUDOU, aoMudar);
  try {
    socket = connectAsGestor();
    socket.on('producao:atualizado', (p: any) => {
      if (p?.status === 'pronto') setTimeout(() => void reler(), DEPOIS_DO_PRONTO_MS);
    });
  } catch {
    socket = null; // sem tempo real: fica a leitura a cada 15 s
  }
}

function parar() {
  if (relogio) clearInterval(relogio);
  relogio = null;
  window.removeEventListener('focus', aoFocar);
  window.removeEventListener(EVENTO_TOTEM_MUDOU, aoMudar);
  try {
    socket?.disconnect();
  } catch {
    /* já fechado */
  }
  socket = null;
}

/** Os pedidos do totem em dinheiro sem pagar (vazio com `ativo` falso). */
export function useTotemAPagar(ativo: boolean): DadosTotemAPagar {
  useEffect(() => {
    if (!ativo) return;
    usuarios++;
    if (usuarios === 1) iniciar();
    return () => {
      usuarios--;
      if (!usuarios) parar();
    };
  }, [ativo]);
  const e = useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
    () => estado,
    () => VAZIO,
  );
  return ativo ? e : VAZIO;
}

/** A Retirada viu a lista do totem mudar (pagou, cancelou, entregou): o ícone e a faixa relêem já. */
export function avisarTotemMudou() {
  try {
    window.dispatchEvent(new Event(EVENTO_TOTEM_MUDOU));
  } catch {
    /* fora do navegador */
  }
}
