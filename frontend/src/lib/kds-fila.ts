// KDS — regras PURAS da fila (sem React, sem navegador): cor do tempo, etapas, soma por item e a
// decisão do teclado. A tela (`app/kds/page.tsx`) e os cartões (`components/kds/*`) só desenham o
// que sai daqui. Conferido por `scripts/check-kds.mjs` (npm run check:kds).

import { rotuloSenha } from './senha';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ── Cor: a ÚNICA cor da tela é o status do tempo (decisão do dono, 02/10/2026) ──────────────
// Verde, amarelo e vermelho; cancelado é cinza (o vermelho fica só para atraso). Cada cor já
// vem com o texto que se lê em cima dela (contraste AA medido no protótipo).
export type FaixaTempo = 'ok' | 'atencao' | 'atrasado';
export type CorStatus = { fundo: string; texto: string };
export const COR_STATUS: Record<FaixaTempo | 'cancelado', CorStatus> = {
  ok: { fundo: '#08853A', texto: '#FFFFFF' },
  atencao: { fundo: '#FFD60A', texto: '#111111' },
  atrasado: { fundo: '#E60000', texto: '#FFFFFF' },
  cancelado: { fundo: '#5F6B76', texto: '#FFFFFF' },
};

export type LimitesTempo = { verdeAteMin: number; amareloAteMin: number };

export function minutosDesde(criadoEm: string | number | Date, agoraMs: number): number {
  return Math.max(0, Math.floor((agoraMs - new Date(criadoEm).getTime()) / 60000));
}

// Limiares do gerente (Configurações do KDS): até X verde, até Y amarelo, depois vermelho.
export function faixaTempo(min: number, limites: LimitesTempo): FaixaTempo {
  if (min <= limites.verdeAteMin) return 'ok';
  if (min <= limites.amareloAteMin) return 'atencao';
  return 'atrasado';
}

export function corDoPedido(p: any, min: number, limites: LimitesTempo): CorStatus {
  return p?.status === 'cancelado' ? COR_STATUS.cancelado : COR_STATUS[faixaTempo(min, limites)];
}

// Atrasado = passou do tempo de preparo do próprio pedido OU já entrou no vermelho. Cancelado nunca.
export function estaAtrasado(p: any, min: number, limites: LimitesTempo): boolean {
  if (p?.status === 'cancelado') return false;
  const preparo = Number(p?.tempoPreparoMin);
  if (preparo > 0 && min > preparo) return true;
  return faixaTempo(min, limites) === 'atrasado';
}

// ── Etapas ────────────────────────────────────────────────────────────────────────────────
const ETAPA: Record<string, string> = { recebido: 'A iniciar', preparo: 'Em preparo', pronto: 'Pronto', cancelado: 'Cancelado' };
export const rotuloEtapa = (status: string) => ETAPA[status] ?? status;
export const proximaAcao = (status: string) => (status === 'recebido' ? 'Iniciar' : status === 'preparo' ? 'Pronto' : 'Entregar');

export type FiltroEtapa = 'todos' | 'recebido' | 'preparo' | 'pronto' | 'atrasados';
export const FILTROS_ETAPA: { key: FiltroEtapa; label: string }[] = [
  { key: 'todos', label: 'Todos' },
  { key: 'recebido', label: 'A iniciar' },
  { key: 'preparo', label: 'Em preparo' },
  { key: 'pronto', label: 'Pronto' },
  { key: 'atrasados', label: 'Atrasados' },
];

function naEtapa(p: any, etapa: FiltroEtapa, agoraMs: number, limites: LimitesTempo): boolean {
  if (etapa === 'todos') return true;
  if (etapa === 'atrasados') return estaAtrasado(p, minutosDesde(p.criadoEm, agoraMs), limites);
  return p.status === etapa; // cancelado não entra em nenhuma etapa
}

export function filtrarEtapa(pedidos: any[], etapa: FiltroEtapa, agoraMs: number, limites: LimitesTempo): any[] {
  return etapa === 'todos' ? pedidos : pedidos.filter((p) => naEtapa(p, etapa, agoraMs, limites));
}

export function contarEtapas(pedidos: any[], agoraMs: number, limites: LimitesTempo): Record<FiltroEtapa, number> {
  const n: Record<FiltroEtapa, number> = { todos: pedidos.length, recebido: 0, preparo: 0, pronto: 0, atrasados: 0 };
  for (const p of pedidos) {
    if (p.status === 'recebido' || p.status === 'preparo' || p.status === 'pronto') n[p.status as 'recebido' | 'preparo' | 'pronto'] += 1;
    if (estaAtrasado(p, minutosDesde(p.criadoEm, agoraMs), limites)) n.atrasados += 1;
  }
  return n;
}

// ── Identificação do pedido (a mesma regra de sempre) ────────────────────────────────────────
export function identPedido(p: any): string {
  if (p?.senha) return `Senha ${rotuloSenha(p.senha, p.senhaPrefixo)}`;
  if (p?.mesa) return `Mesa ${p.mesa}`;
  if (p?.numero) return `#${p.numero}`;
  return 'Balcão';
}

// ── Itens ─────────────────────────────────────────────────────────────────────────────────
// Dentro de UM pedido: agrega itens iguais (mesma descrição + complementos + obs) somando.
export function agregarItens(itens: any[]): any[] {
  const mapa = new Map<string, any>();
  for (const it of itens ?? []) {
    const chave = `${it.descricao}|${it.complementosTexto ?? ''}|${it.observacao ?? ''}`;
    const ex = mapa.get(chave);
    if (ex) ex.quantidade = Number(ex.quantidade) + Number(it.quantidade);
    else mapa.set(chave, { ...it, quantidade: Number(it.quantidade) });
  }
  return [...mapa.values()];
}

// O que ainda se PRODUZ: pedido cancelado ou já pronto não entra na soma.
const aProduzir = (p: any) => p.status === 'recebido' || p.status === 'preparo';

export type LinhaDoItem = { pedido: any; item: any; min: number };
export type GrupoDeItem = { descricao: string; quantidade: number; minMaisAntigo: number; linhas: LinhaDoItem[] };

// ENTRE pedidos: um grupo por item (pela descrição), com a soma e os pedidos que o levam.
// Ordem: o item cujo pedido espera há mais tempo vem primeiro; depois a maior quantidade.
export function agruparPorItem(pedidos: any[], agoraMs: number): GrupoDeItem[] {
  const mapa = new Map<string, GrupoDeItem>();
  for (const p of pedidos ?? []) {
    if (!aProduzir(p)) continue;
    const min = minutosDesde(p.criadoEm, agoraMs);
    for (const it of agregarItens(p.itens ?? [])) {
      const descricao = String(it.descricao ?? '').trim() || 'Item sem nome';
      const g = mapa.get(descricao) ?? { descricao, quantidade: 0, minMaisAntigo: 0, linhas: [] };
      g.quantidade += Number(it.quantidade) || 0;
      g.minMaisAntigo = Math.max(g.minMaisAntigo, min);
      g.linhas.push({ pedido: p, item: it, min });
      mapa.set(descricao, g);
    }
  }
  const grupos = [...mapa.values()];
  for (const g of grupos) g.linhas.sort((a, b) => b.min - a.min);
  return grupos.sort((a, b) => b.minMaisAntigo - a.minMaisAntigo || b.quantidade - a.quantidade || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

export type ItemDoResumo = { descricao: string; quantidade: number; pedidos: number };

// Resumo lateral: a mesma soma, da maior quantidade para a menor.
export function somarItens(pedidos: any[]): ItemDoResumo[] {
  return agruparPorItem(pedidos, 0)
    .map((g) => ({ descricao: g.descricao, quantidade: g.quantidade, pedidos: new Set(g.linhas.map((l) => l.pedido.id)).size }))
    .sort((a, b) => b.quantidade - a.quantidade || a.descricao.localeCompare(b.descricao, 'pt-BR'));
}

// O pedido leva o item destacado no resumo? (só conta o que ainda se produz)
export function pedidoTemItem(p: any, descricao: string): boolean {
  return aProduzir(p) && (p.itens ?? []).some((it: any) => String(it.descricao ?? '').trim() === descricao);
}

// ── Forma de uso: toque × teclado ──────────────────────────────────────────────────────────
// TECLADO: o campo da senha é o dono do foco. Número digitado em qualquer lugar vai para ele;
// Enter fora do campo NUNCA aciona o botão que estava em foco — com número avança o pedido, sem
// número só leva o foco para o campo. TOQUE: nada depende do foco (Enter num botão é do botão).
export type FormaUso = 'toque' | 'teclado';
export type TeclaDoKds = { acao: 'ignorar' | 'digito' | 'enter' | 'apagar'; tomar: boolean };

export function decidirTecla(uso: FormaUso, tecla: string, alvo: { tag: string; ehCampoSenha: boolean }): TeclaDoKds {
  const nada: TeclaDoKds = { acao: 'ignorar', tomar: false };
  if (alvo.ehCampoSenha) return nada; // o próprio campo trata
  const acao = /^[0-9]$/.test(tecla) ? 'digito' : tecla === 'Enter' ? 'enter' : tecla === 'Backspace' ? 'apagar' : 'ignorar';
  if (acao === 'ignorar') return nada;
  const tag = alvo.tag.toUpperCase();
  if (tag === 'INPUT' || tag === 'TEXTAREA') return nada; // outro campo de texto: é dele
  if (uso === 'teclado') return { acao, tomar: true }; // toma a tecla (preventDefault) e foca o campo
  if (tag === 'SELECT') return nada;
  if (tag === 'BUTTON' && acao === 'enter') return nada;
  return { acao, tomar: false };
}

export function formaDeUso(escolhida: string | null | undefined, telaDeToque: boolean): FormaUso {
  if (escolhida === 'toque' || escolhida === 'teclado') return escolhida;
  return telaDeToque ? 'toque' : 'teclado'; // primeiro uso: adivinha pelo aparelho
}
