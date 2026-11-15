/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A SITUAÇÃO DA LOJA NA 99 (15/11/2026, pedido do dono — ERR-471): na quinta, sem luz, o dono fechou o iFood, a 99 e a Anota Aí, e o
 * atendente do Instagram dizia "estamos abertos" — ele só olhava o horário do cardápio digital. Agora o atendente confere a
 * situação real dos aplicativos (`cardapio/situacao-da-loja.ts`). A 99 avisa sozinha quando a loja muda (aviso `shopStatus`,
 * assinado — doc "Store Webhooks" 1957) e diz o mesmo no detalhe da loja (`shop/detail`, doc 1943): nenhuma consulta a
 * cada mensagem.
 *
 * Campos (doc 1943/1949): `biz_status` 1 aberta | 2 fechada; `sub_biz_status` 1 aberta, 2 pausada, 3 fechada (só abre à
 * mão), 4 desconectada (o app da loja caiu — rede ou energia), 5 fora do horário, 6 bloqueada, 7 sem entregador; e
 * `store_availability_status` 1 atende | 2 não atende, com `store_unavailable_reason` e `store_unavailable_end_time`.
 * O `pause_reason_code` (1001 a 1006) só vem no `setStatus`; quando vem, entra como o motivo.
 */

export type EstadoNaPlataforma = 'aberta' | 'pausada' | 'fechada' | 'desconectada' | 'fora_do_horario' | 'bloqueada' | 'sem_entregador';

export type SituacaoNoCanal = {
  estado: EstadoNaPlataforma;
  /** O motivo em palavras, quando a plataforma diz (pausa por falta de energia, de ingredientes…). */
  motivo: string | null;
  /** Até quando (ISO), quando a plataforma diz. */
  ate: string | null;
  /** Quando o Regem soube (ISO). */
  em: string;
  fonte: 'aviso' | 'leitura';
};

const POR_SUB: Record<number, EstadoNaPlataforma> = {
  1: 'aberta',
  2: 'pausada',
  3: 'fechada',
  4: 'desconectada',
  5: 'fora_do_horario',
  6: 'bloqueada',
  7: 'sem_entregador',
};

/** O motivo da pausa da 99 em palavras (os mesmos códigos que o Regem manda ao pausar — `common/pausa-do-canal`). */
export const MOTIVO_DA_PAUSA_99: Record<number, string> = {
  1001: 'problema de equipamento ou falta de energia',
  1002: 'equipe reduzida no momento',
  1003: 'falta de ingredientes',
  1004: 'perto do horário de fechar',
  1005: 'muito movimento no salão',
  1006: 'outro motivo',
};

const inteiro = (v: unknown): number | null => {
  const n = Number(v);
  return Number.isInteger(n) ? n : null;
};

/**
 * A situação a partir do `data` do aviso ou do detalhe da loja. Sem nenhum campo de situação reconhecível: null (não
 * inventa — o atendente segue como se não soubesse da 99).
 */
export function situacaoDa99(data: any, em: Date, fonte: 'aviso' | 'leitura'): SituacaoNoCanal | null {
  if (!data || typeof data !== 'object') return null;
  const sub = inteiro(data.sub_biz_status);
  const biz = inteiro(data.biz_status);
  const disponivel = inteiro(data.store_availability_status);
  let estado: EstadoNaPlataforma | null = sub != null && POR_SUB[sub] ? POR_SUB[sub] : null;
  if (!estado && biz != null) estado = biz === 1 ? 'aberta' : biz === 2 ? 'fechada' : null;
  if (!estado && disponivel != null) estado = disponivel === 1 ? 'aberta' : null;
  if (!estado) return null;
  // Aberta no sistema, mas "não atende" agora (a 99 diz o motivo): conta como pausada.
  if (estado === 'aberta' && disponivel === 2) estado = 'pausada';
  const codigo = inteiro(data.pause_reason_code);
  const razao = String(data.store_unavailable_reason ?? '').trim();
  const motivo = (codigo != null ? MOTIVO_DA_PAUSA_99[codigo] : null) ?? (razao ? razao.slice(0, 120) : null);
  const fim = inteiro(data.store_unavailable_end_time);
  const ate = fim && fim > 0 ? new Date(fim * 1000).toISOString() : null;
  return { estado, motivo: estado === 'aberta' ? null : motivo, ate: estado === 'aberta' ? null : ate, em: em.toISOString(), fonte };
}

/** A situação guardada passou de `horas` (ou nunca foi lida)? A rotina lê o detalhe da loja de novo — no máximo umas 4 vezes por dia. */
export function situacaoVelha(guardada: any, agora: Date, horas = 6): boolean {
  const em = guardada?.em ? new Date(guardada.em).getTime() : NaN;
  return !Number.isFinite(em) || agora.getTime() - em > horas * 3_600_000;
}
