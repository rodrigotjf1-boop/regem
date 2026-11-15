'use client';

import { useSyncExternalStore } from 'react';
import { api, ApiError } from '@/lib/api';

// OS AVISOS DO MISTER NA TELA DA LOJA (F1.4, protótipo `mockups/regem-avisos-na-tela.html` aprovado em 14/11/2026): o
// estado comum da faixa abaixo do topo, do ⚠️ do topo e da gaveta "Avisos da loja". Uma leitura por vez; quem chama
// durante uma leitura espera a mesma. A tela relê a cada minuto e na hora pelo tempo real (`mister:avisos`, na nuvem).

export interface AvisoNaTela {
  id: string;
  grupo: string;
  titulo: string;
  detalhe: string | null;
  abertoEm: string;
  escalado: boolean;
  tambem: string[];
  ciente: boolean;
}

export interface EstadoDosAvisos {
  avisos: AvisoNaTela[];
  lida: boolean;
  /** O servidor da loja não falou com a nuvem: a tela não mostra a faixa (e não diz "nenhum aviso"). */
  semConexao: boolean;
  /** O módulo Mister está desligado nesta empresa (403/404): a tela para de perguntar. */
  desligado: boolean;
}

let estado: EstadoDosAvisos = { avisos: [], lida: false, semConexao: false, desligado: false };
const ouvintes = new Set<() => void>();
const mudar = (novo: EstadoDosAvisos) => {
  estado = novo;
  ouvintes.forEach((f) => f());
};

export function useAvisosDaLoja(): EstadoDosAvisos {
  return useSyncExternalStore(
    (f) => {
      ouvintes.add(f);
      return () => ouvintes.delete(f);
    },
    () => estado,
    () => estado,
  );
}

let lendo: Promise<void> | null = null;
/** Relê os avisos abertos da loja. Nunca lança: a falha mantém o que já estava (a faixa não pisca por uma queda). */
export function relerAvisos(): Promise<void> {
  if (lendo) return lendo;
  lendo = (async () => {
    try {
      const r = (await api.get('/mister/avisos/abertos')) as { avisos?: AvisoNaTela[]; semConexao?: boolean };
      mudar({ avisos: Array.isArray(r?.avisos) ? r.avisos : [], lida: true, semConexao: r?.semConexao === true, desligado: false });
    } catch (e) {
      // Módulo desligado ou rota que não existe (servidor da loja antigo): para de perguntar.
      if (e instanceof ApiError && (e.status === 403 || e.status === 404)) mudar({ avisos: [], lida: true, semConexao: false, desligado: true });
    } finally {
      lendo = null;
    }
  })();
  return lendo;
}

/** "Ciente" de quem está logado: some da faixa dele na hora (e o servidor guarda). */
export async function darCiente(id: string): Promise<void> {
  mudar({ ...estado, avisos: estado.avisos.map((a) => (a.id === id ? { ...a, ciente: true } : a)) });
  try {
    await api.post(`/mister/avisos/${id}/ciente`, {});
  } finally {
    void relerAvisos();
  }
}

/** "há 3 min", "há 2 h 05 min". */
export function haQuanto(iso: string, agora: number = Date.now()): string {
  const min = Math.max(0, Math.round((agora - new Date(iso).getTime()) / 60_000));
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  return `há ${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}
