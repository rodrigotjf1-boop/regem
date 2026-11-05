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
  /** A mudança de endereço feita pelo caso (PR 3b-2), pela alteração do pedido: a loja aplicou, recusou; o cliente soube. */
  mudancaDoEndereco?: {
    situacao: 'aplicada' | 'pedida' | 'recusada' | 'vencida';
    motivo: string | null;
    aviso: { em: string; falhou?: string; expirou?: boolean; semTelefone?: boolean } | null;
  } | null;
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
export type EstadoDaFila = {
  casos: CasoDaFila[];
  contagens: ContagensDaFila | null;
  lida: boolean;
  erro: boolean;
  eu: string | null;
  /** Os avisos da disputa (ajuste do iFood): avisar o gerente quando chega; avisar de novo quando faltarem N min. */
  avisos: AvisosDaFila;
  /** A ponte do chat do iFood e da 99 (mig 366): a faixa do topo da tela. `null` = não veio (servidor da loja, falha). */
  ponte: SituacaoDaPonte | null;
};
export type AvisosDaFila = { disputa: { avisar: boolean; deNovoMin: number } };
/** Por canal conectado: qual PC responde agora (null = nenhum) e os nomes das pontes de reserva (vivas e logadas). */
export type SituacaoDaPonte =
  | { ligada: false }
  | {
      ligada: true;
      /** As pontes cadastradas da loja (pareadas ou não): 0 = nenhum PC cadastrado como ponte. */
      pontes: number;
      canais: Partial<Record<'ifood' | '99food', { responde: { nome: string; maquina: string | null } | null; reservas: string[] }>>;
      ultimaMensagemEm: string | null;
    };
/** Os padrões do servidor (`AJUSTE_IFOOD_PADRAO`): a tela usa enquanto não leu. */
export const AVISOS_PADRAO: AvisosDaFila = { disputa: { avisar: true, deNovoMin: 2 } };

let estado: EstadoDaFila = { casos: [], contagens: null, lida: false, erro: false, eu: null, avisos: AVISOS_PADRAO, ponte: null };
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
        avisos:
          typeof r?.avisos?.disputa?.avisar === 'boolean' && typeof r?.avisos?.disputa?.deNovoMin === 'number'
            ? { disputa: { avisar: r.avisos.disputa.avisar, deNovoMin: r.avisos.disputa.deNovoMin } }
            : AVISOS_PADRAO,
        ponte: r?.ponte && typeof r.ponte.ligada === 'boolean' ? (r.ponte as SituacaoDaPonte) : null,
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
  // A mensagem do cliente no chat do iFood ou da 99, trazida pela ponte (Etapa 2).
  chat: 'Mensagem no chat',
};

/** A situação do pedido ligado ao caso ou à conversa, como a equipe fala. */
export const STATUS_DO_PEDIDO: Record<string, string> = {
  novo: 'Novo',
  confirmado: 'Em produção',
  pronto: 'Pronto',
  despachado: 'Em rota',
  entregue: 'Entregue',
  concluido: 'Concluído',
  cancelado: 'Cancelado',
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

/** Uma mensagem do chat do iFood/99 (a conversa do pedido). */
export type MensagemDaConversa = {
  id: string;
  direcao: 'entrada' | 'saida';
  autor: 'cliente' | 'loja' | 'robo' | 'equipe' | 'aviso';
  texto: string;
  estado: string;
  motivo: string | null;
  em: string;
};
/**
 * "Conversas agora": a conversa que o robô (ou os avisos) atende, sem caso aberto — do chat do iFood/99 (ponte do chat,
 * com as últimas mensagens) ou do WhatsApp (o número e a última mensagem; a conversa a tela lê da caixa ao abrir).
 */
export type ConversaAgora = {
  canal: 'ifood' | '99food' | 'whatsapp';
  chave: string;
  ultima: string;
  cliente: string | null;
  pedidoId: string | null;
  pedidoNumero: string | null;
  pedidoStatus: string | null;
  mensagens: MensagemDaConversa[];
  /** O robô está atendendo (no iFood/99, se o robô do chat está ligado; no WhatsApp, sempre — só vem com ele ligado). */
  comRobo?: boolean;
  /** WhatsApp: o número (só dígitos), os jids da caixa e a última mensagem. */
  telefone?: string | null;
  jids?: string[];
  ultimaMensagem?: string | null;
};
export const idDaConversa = (c: { canal: string; chave: string }) => `${c.canal}|${c.chave}`;
/** "(21) 97654-3210" a partir dos dígitos (com ou sem o 55). */
export function telefoneLegivel(t: string | null | undefined): string {
  const d = String(t ?? '').replace(/\D/g, '');
  const n = d.length > 11 && d.startsWith('55') ? d.slice(2) : d;
  if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
  if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
  return d;
}
/** "Maria S. · pedido iFood 4821" — como o título do caso; no WhatsApp, o nome (do perfil do WhatsApp) ou o número. */
export function tituloDaConversa(c: ConversaAgora): string {
  if (c.canal === 'whatsapp') return c.cliente || telefoneLegivel(c.telefone) || 'Cliente';
  const plataforma = c.canal === 'ifood' ? 'iFood' : '99Food';
  return `${c.cliente || 'Cliente'}${c.pedidoNumero ? ` · pedido ${plataforma} ${c.pedidoNumero}` : ` · chat ${c.canal === 'ifood' ? 'do iFood' : 'da 99'}`}`;
}
/** O que aconteceu por último: a fala do cliente e, se houve, o que o robô (ou o aviso) disse depois. */
export function resumoDaConversa(c: ConversaAgora): string {
  // WhatsApp: a última mensagem da conversa, sem aspas — a lista da caixa não diz se foi o cliente ou a loja.
  if (!c.mensagens.length) return c.ultimaMensagem ?? '';
  const ultimaDoCliente = [...c.mensagens].reverse().find((m) => m.direcao === 'entrada' && m.autor === 'cliente');
  const ultima = c.mensagens[c.mensagens.length - 1];
  if (ultima && ultima.direcao === 'saida') {
    const quem = ultima.autor === 'aviso' ? 'aviso automático' : ultima.autor === 'robo' ? 'o robô' : 'a equipe';
    return ultimaDoCliente ? `"${ultimaDoCliente.texto}" · ${quem} respondeu` : `${quem}: ${ultima.texto}`;
  }
  return ultimaDoCliente ? `"${ultimaDoCliente.texto}"` : ultima?.texto ?? '';
}

/**
 * O resumo do topo da tela Atendimento: "o robô está em 3 conversas no WhatsApp, no iFood e na 99" — os canais em que o
 * robô atende para quem está na tela —; com a ponte ligada e o robô do chat desligado, "2 conversas no chat do iFood e da
 * 99 sem caso".
 */
export function resumoDasConversas(conversas: ConversaAgora[], o: { comWhatsapp: boolean; comPonte: boolean; roboResponde: boolean }): string {
  const fmt = (n: number) => (n === 1 ? '1 conversa' : `${n} conversas`);
  const comRobo = conversas.filter((c) => c.comRobo ?? o.roboResponde).length;
  const onde = [o.comWhatsapp ? 'no WhatsApp' : '', o.comPonte && o.roboResponde ? 'no iFood e na 99' : ''].filter(Boolean);
  const partes: string[] = [];
  if (onde.length) partes.push(`o robô está em ${fmt(comRobo)} ${onde.join(', ')}`);
  if (o.comPonte && !o.roboResponde) partes.push(`${fmt(conversas.length - comRobo)} no chat do iFood e da 99 sem caso`);
  return partes.join(' · ');
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
