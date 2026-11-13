/* eslint-disable @typescript-eslint/no-explicit-any */

// IA POR EMPRESA (mig 415) — as regras puras: quais provedores o Regem aceita, o formato da chave, o que cada recusa do
// provedor quer dizer, o consumo de uma chamada e o custo estimado. Nada aqui lê banco, rede ou relógio.
//
// Decisão do dono (12/11/2026): cada lojista configura a PRÓPRIA chave de IA; a loja piloto usa a Anthropic; outras
// (OpenAI, Gemini) só entram depois de testadas. Por isso a lista de aceitos mora aqui, num lugar só.

/** Os provedores que já passaram pelos testes do Regem. Cada novo entra aqui junto com o adaptador dele. */
export const PROVEDORES_ACEITOS = ['anthropic'] as const;
export type ProvedorDeIa = (typeof PROVEDORES_ACEITOS)[number];

/** De quem é a chave que pagou a chamada. */
export type OrigemDaChave = 'lojista' | 'distribuicao';

/** Por que a chamada não aconteceu ou não voltou. */
export type MotivoDaFalha =
  | 'sem_chave'
  | 'chave_recusada'
  | 'sem_credito'
  | 'teto_atingido'
  | 'limite_por_minuto'
  | 'indisponivel'
  | 'pedido_invalido';

/** O que a última chamada disse da chave guardada. */
export type SituacaoDaChave = 'ok' | 'chave_recusada' | 'sem_credito' | 'teto_atingido';

/** As recusas que dizem algo da CHAVE (e não do momento): mudam a situação guardada. */
export const FALHA_QUE_MARCA_A_CHAVE: readonly MotivoDaFalha[] = ['chave_recusada', 'sem_credito', 'teto_atingido'];

export const ehProvedorAceito = (p: unknown): p is ProvedorDeIa => (PROVEDORES_ACEITOS as readonly string[]).includes(String(p));

/**
 * O que há de errado com a chave colada, em frase para a tela — ou null se o formato serve. Confere só o formato: se a
 * chave VALE, quem diz é o provedor (a prova, no serviço). A frase nunca repete a chave.
 */
export function motivoDaChaveInvalida(provedor: ProvedorDeIa, chave: string): string | null {
  if (!chave) return 'Cole a chave de IA.';
  if (/\s/.test(chave)) return 'A chave não pode ter espaço nem quebra de linha. Copie de novo, inteira.';
  if (chave.length < 40 || chave.length > 400) return 'A chave parece incompleta. Copie de novo, inteira.';
  if (provedor === 'anthropic') {
    if (!chave.startsWith('sk-ant-')) return 'Esta não parece uma chave da Anthropic: ela começa com "sk-ant-".';
    // A chave de administração mexe na conta inteira do lojista (membros, chaves, limites): não é a que o Regem usa.
    if (chave.startsWith('sk-ant-admin')) return 'Esta é uma chave de administração da conta. Crie uma chave comum em API keys › Create key.';
  }
  return null;
}

/** Os 4 últimos caracteres, para o dono reconhecer qual chave está salva. */
export const finalDaChave = (chave: string): string => chave.slice(-4);

/**
 * O que a recusa do provedor quer dizer, pela documentação da Anthropic (lida em 12/11/2026):
 *  • 401 = chave malformada, revogada ou vencida; 403 = a chave não tem permissão;
 *  • 402 = problema de cobrança; 400 com "credit balance" = sem crédito;
 *  • 400 cuja mensagem começa com "You have reached your specified (workspace) API usage limits" = o teto de gasto que o
 *    próprio dono da conta definiu; 429 com `enforced_spend_limit_reached` = o teto mensal do nível da conta;
 *  • os outros 429 = limite por minuto (passa sozinho); 5xx, 529 e sem status (rede, prazo) = o provedor fora.
 */
export function classificarFalha(e: { status?: number | null; tipo?: string | null; mensagem?: string | null; codigo?: string | null }): MotivoDaFalha {
  const status = Number(e.status) || 0;
  const mensagem = String(e.mensagem ?? '').toLowerCase();
  if (status === 401 || status === 403) return 'chave_recusada';
  if (status === 402 || e.tipo === 'billing_error') return 'sem_credito';
  if (status === 400) {
    if (mensagem.includes('credit balance')) return 'sem_credito';
    if (mensagem.includes('usage limits')) return 'teto_atingido';
    return 'pedido_invalido';
  }
  if (status === 429) return e.codigo === 'enforced_spend_limit_reached' ? 'teto_atingido' : 'limite_por_minuto';
  if (status >= 400 && status < 500) return 'pedido_invalido';
  return 'indisponivel';
}

/** O consumo de uma chamada, em tokens. */
export interface UsoDaChamada {
  entrada: number;
  cacheEscrita: number;
  cacheLeitura: number;
  saida: number;
}
export const USO_ZERO: UsoDaChamada = { entrada: 0, cacheEscrita: 0, cacheLeitura: 0, saida: 0 };

const inteiro = (v: unknown): number => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** O consumo que a resposta da Anthropic traz em `usage` (campo ausente ou estranho vale zero). */
export function lerUso(usage: any): UsoDaChamada {
  return {
    entrada: inteiro(usage?.input_tokens),
    cacheEscrita: inteiro(usage?.cache_creation_input_tokens),
    cacheLeitura: inteiro(usage?.cache_read_input_tokens),
    saida: inteiro(usage?.output_tokens),
  };
}

/** Quando a tabela de preços abaixo foi lida na página pública do provedor. */
export const PRECOS_LIDOS_EM = '2026-11-12';

/**
 * US$ por MILHÃO de tokens (entrada, escrita de cache de 5 min, leitura de cache, saída). Só para ESTIMAR o gasto na
 * tela: a conta de verdade é a do console do provedor. O Haiku 5.5 cobra mais em pedido acima de 100 mil tokens — o
 * Regem não manda pedido desse tamanho, e a estimativa não cobre esse caso.
 */
export const PRECOS_POR_MILHAO: Record<string, UsoDaChamada> = {
  'claude-haiku-5-5': { entrada: 0.1, cacheEscrita: 0.125, cacheLeitura: 0.01, saida: 0.5 },
  'claude-sonnet-5-5': { entrada: 2, cacheEscrita: 2.5, cacheLeitura: 0.1, saida: 10 },
  'claude-opus-5-5': { entrada: 4, cacheEscrita: 5, cacheLeitura: 0.2, saida: 20 },
};

/** O custo estimado em US$ — ou null quando o modelo não está na tabela (nunca um preço inventado). */
export function custoEstimadoUsd(modelo: string, uso: UsoDaChamada): number | null {
  const p = PRECOS_POR_MILHAO[modelo];
  if (!p) return null;
  const total = uso.entrada * p.entrada + uso.cacheEscrita * p.cacheEscrita + uso.cacheLeitura * p.cacheLeitura + uso.saida * p.saida;
  return Math.round(total) / 1_000_000;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const valido = (iso: string): boolean => DIA.test(iso) && !Number.isNaN(Date.parse(`${iso}T12:00:00Z`)) && new Date(`${iso}T12:00:00Z`).toISOString().slice(0, 10) === iso;
const menosDias = (iso: string, dias: number): string => new Date(Date.parse(`${iso}T12:00:00Z`) - dias * 86_400_000).toISOString().slice(0, 10);

/** O período pedido para o medidor (padrão: os últimos 30 dias até hoje; no máximo um ano) — ou a frase do que está errado. */
export function periodoDoUso(de: unknown, ate: unknown, hoje: string): { de: string; ate: string } | { erro: string } {
  const fim = ate === undefined || ate === null || ate === '' ? hoje : String(ate);
  if (!valido(fim)) return { erro: 'A data final não é uma data válida.' };
  const ini = de === undefined || de === null || de === '' ? menosDias(fim, 29) : String(de);
  if (!valido(ini)) return { erro: 'A data inicial não é uma data válida.' };
  if (ini > fim) return { erro: 'A data inicial vem depois da final.' };
  if (ini < menosDias(fim, 366)) return { erro: 'Escolha um período de até um ano.' };
  return { de: ini, ate: fim };
}
