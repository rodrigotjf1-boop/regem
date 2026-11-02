'use client';

import { useSyncExternalStore } from 'react';
import { api } from './api';

// CENTRAL DE ATENDIMENTO (Onda 1 — protótipo `mockups/regem-central-atendimento.html`, aprovado em 02/11/2026).
// A fila é lida num lugar só: o ALERTA (montado no Shell, em todas as telas) relê a cada 15 s e no tempo real; a tela
// "Atendimento" e o sino do topo leem daqui. Assim cada tela aberta faz UMA leitura, não três.

export type CasoDaFila = {
  id: string;
  tipo: string;
  canal: string | null;
  cliente: string | null;
  telefone: string | null;
  mensagem: string | null;
  prioridade: 'normal' | 'urgente';
  status: string;
  decisao?: string | null;
  pedidoId: string | null;
  pedidoNumero: string | null;
  pedidoCanal?: string | null;
  pedidoStatus?: string | null;
  pedidoNaPlataforma?: string | null;
  pedidoCliente?: string | null;
  unidadeId?: string | null;
  responsavelId: string | null;
  responsavelNome?: string | null;
  pegoEm: string | null;
  aguardandoDesde: string | null;
  prazoEm: string | null;
  criadoEm: string;
  resolvidoEm?: string | null;
  resolvidoPorNome?: string | null;
  situacao: 'fila' | 'com_alguem' | 'aguardando' | 'resolvido';
  posicao?: number | null;
  /** O que a plataforma mandou e o que a loja respondeu (mig 351): a disputa do iFood, o pedido da 99. */
  detalhe?: any;
  externoId?: string | null;
};

/**
 * O AVISO AO GERENTE (mig 353): o caso que ninguém pegou no tempo do ajuste ("Fila e avisos") ganha `detalhe.escalado`
 * na nuvem. Só conta enquanto o caso continua na fila — pegou, passou ou resolveu, o aviso deixa de valer.
 */
export function escaladoDe(c: CasoDaFila): { em: string; minutos: number } | null {
  const e = c.detalhe?.escalado;
  return c.situacao === 'fila' && e?.em ? { em: String(e.em), minutos: Number(e.minutos) || 0 } : null;
}

export type ContagensDaFila = {
  abertos: number;
  comPrazo: number;
  naFila: number;
  comigo: number;
  aguardando: number;
  resolvidosHoje: number;
};

/**
 * O que a tela sabe da fila. `lida` = já houve uma leitura certa; `erro` = a última leitura falhou (≠ fila vazia);
 * `eu` = o colaborador de quem pediu (o servidor diz — na nuvem a sessão é um cookie que a tela não lê).
 */
export type EstadoDaFila = { casos: CasoDaFila[]; contagens: ContagensDaFila | null; lida: boolean; erro: boolean; eu: string | null };

let estado: EstadoDaFila = { casos: [], contagens: null, lida: false, erro: false, eu: null };
const ouvintes = new Set<() => void>();
const avisar = () => ouvintes.forEach((f) => f());

export function useFilaDeAtendimento(): EstadoDaFila {
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
/** Relê a fila (uma leitura por vez: quem chama durante uma leitura espera a mesma). */
export function relerFila(): Promise<void> {
  if (lendo) return lendo;
  lendo = (async () => {
    try {
      const r: any = await api.atendimentoFila();
      estado = {
        casos: Array.isArray(r?.casos) ? r.casos : [],
        contagens: r?.contagens ?? null,
        lida: true,
        erro: false,
        eu: typeof r?.eu === 'string' ? r.eu : null,
      };
    } catch {
      // A leitura falhou: o que já estava na tela fica, marcado como "não li agora" — nunca vira "fila vazia" (V37).
      estado = { ...estado, erro: true };
    } finally {
      lendo = null;
      avisar();
    }
  })();
  return lendo;
}

export const ROTULO_DO_CANAL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  cardapio: 'Cardápio',
  anotaai: 'Anota AI',
  ifood: 'iFood',
  '99food': '99Food',
};

/** Classes do chip do canal (cores de identificação do canal, com contraste conferido). */
export const COR_DO_CANAL: Record<string, string> = {
  whatsapp: 'bg-[#0B6E3A] text-white',
  ifood: 'bg-[#C3122B] text-white',
  '99food': 'bg-[#FFD21F] text-[#2A2300]',
  cardapio: 'border border-[#E9CF9E] bg-[#FCF1DD] text-[#7A5209]',
  anotaai: 'bg-secondary text-foreground',
};

/** O motivo do caso, como a equipe fala. */
export const ROTULO_DO_TIPO: Record<string, string> = {
  mudanca: 'Mudança no pedido',
  erro: 'Problema no pedido',
  humano: 'Quer falar com alguém',
  cancelamento: 'Pedido de cancelamento',
  outro: 'Atendimento',
  disputa: 'Disputa',
  cancelamento_99: 'Cancelamento pedido à 99',
  reembolso_99: 'Reembolso pedido à 99',
};

/** Casos que se resolvem pela resposta à plataforma (ou pelo prazo): "aguardar" e "resolver" à mão os esconderiam. */
export const CASO_DA_PLATAFORMA = new Set(['disputa', 'cancelamento_99', 'reembolso_99']);

/** "Ana P. · pedido iFood 4521": cliente + plataforma + número (o da plataforma quando há; senão o da loja). */
export function tituloDoCaso(c: CasoDaFila): string {
  const quem = c.cliente || c.pedidoCliente || 'Cliente';
  const plataforma = c.canal === 'ifood' ? 'iFood' : c.canal === '99food' ? '99Food' : '';
  const numero = c.pedidoNaPlataforma && plataforma ? c.pedidoNaPlataforma : c.pedidoNumero;
  if (!numero) return quem;
  return `${quem} · pedido ${plataforma ? `${plataforma} ` : '#'}${numero}`;
}

/** "agora", "4 min", "1 h 20 min" desde o instante. */
export function tempoDesde(iso: string | null | undefined, agora: number): string {
  if (!iso) return '';
  const min = Math.max(0, Math.floor((agora - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'agora';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  return `${h} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

/** "03:40" (ou "1:05:00") até o prazo; "venceu" depois. */
export function tempoAte(iso: string | null | undefined, agora: number): string {
  if (!iso) return '';
  const s = Math.round((new Date(iso).getTime() - agora) / 1000);
  if (s <= 0) return 'venceu';
  const dd = (n: number) => String(n).padStart(2, '0');
  return s >= 3600 ? `${Math.floor(s / 3600)}:${dd(Math.floor((s % 3600) / 60))}:${dd(s % 60)}` : `${dd(Math.floor(s / 60))}:${dd(s % 60)}`;
}

export const hora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }) : '';
