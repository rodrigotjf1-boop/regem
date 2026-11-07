// A FILA DE ATENDIMENTO (central de atendimento, Onda 1 — protótipo `mockups/regem-central-atendimento.html`, aprovado
// pelo dono em 02/11/2026). Regras puras, sem banco: os testes conferem cada uma sozinha.
//
// O caso tem um ciclo: na fila → com alguém → aguardando o cliente → resolvido. A ORDEM da fila é uma só, a mesma no
// computador, no app e no que o robô diz ao cliente: o que tem PRAZO vencendo (disputa do iFood, pedido da 99), depois o
// URGENTE (cliente irritado), depois quem espera HÁ MAIS TEMPO.

/* eslint-disable @typescript-eslint/no-explicit-any */

/** De onde o caso veio. NULL nos chamados antigos (antes da mig 350): `canalDoCaso` deduz. */
export const CANAIS = ['whatsapp', 'cardapio', 'anotaai', 'ifood', '99food', 'instagram'] as const;
export type Canal = (typeof CANAIS)[number];

export function canalValido(v: unknown): Canal | null {
  return (CANAIS as readonly string[]).includes(String(v)) ? (v as Canal) : null;
}

/**
 * O canal do caso: o gravado; sem ele (chamado antigo), o do pedido ligado (o `canal` do `pedido_externo` — 'cardapio'
 * é o cardápio da loja, que o robô também usa); sem pedido, quem tem telefone veio do robô do WhatsApp.
 */
export function canalDoCaso(c: { canal?: string | null; pedidoCanal?: string | null; telefone?: string | null }): Canal | null {
  const gravado = canalValido(c.canal);
  if (gravado) return gravado;
  const doPedido = canalValido(c.pedidoCanal);
  if (doPedido) return doPedido;
  return c.telefone ? 'whatsapp' : null;
}

export type Situacao = 'fila' | 'com_alguem' | 'aguardando' | 'resolvido';

export function situacaoDo(c: { status?: string | null; responsavelId?: string | null; aguardandoDesde?: unknown }): Situacao {
  if (c.status === 'resolvido') return 'resolvido';
  if (c.aguardandoDesde) return 'aguardando';
  return c.responsavelId ? 'com_alguem' : 'fila';
}

const ms = (d: unknown) => (d ? new Date(d as any).getTime() : NaN);

/** A ordem da fila (a mesma do SQL de `AtendimentoService.fila`): prazo mais curto, urgente, mais antigo. */
export function compararNaFila(
  a: { prazoEm?: unknown; prioridade?: string | null; criadoEm?: unknown },
  b: { prazoEm?: unknown; prioridade?: string | null; criadoEm?: unknown },
): number {
  const pa = ms(a.prazoEm);
  const pb = ms(b.prazoEm);
  const temA = !Number.isNaN(pa);
  const temB = !Number.isNaN(pb);
  if (temA !== temB) return temA ? -1 : 1;
  if (temA && temB && pa !== pb) return pa - pb;
  const ua = a.prioridade === 'urgente';
  const ub = b.prioridade === 'urgente';
  if (ua !== ub) return ua ? -1 : 1;
  return ms(a.criadoEm) - ms(b.criadoEm);
}

/**
 * A POSIÇÃO de cada caso que espera uma pessoa (1º, 2º…): só os que estão "na fila" — sem responsável, sem esperar o
 * cliente e sem prazo de plataforma (a disputa tem o relógio dela, não uma vez na fila). A lista já vem na ordem da fila.
 */
export function posicoes<T extends { prazoEm?: unknown; responsavelId?: string | null; aguardandoDesde?: unknown; status?: string | null }>(
  ordenados: T[],
): Array<T & { posicao: number | null }> {
  let n = 0;
  return ordenados.map((c) => {
    const conta = situacaoDo(c) === 'fila' && !c.prazoEm;
    return { ...c, posicao: conta ? ++n : null };
  });
}
