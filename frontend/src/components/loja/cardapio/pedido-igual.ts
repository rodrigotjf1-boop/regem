// PEDIDO IGUAL EM ATÉ 30 MIN (mig 360; pedido do dono, 03/11/2026 — protótipo `mockups/regem-alteracao-pedido.html`).
// O servidor recusa o pedido com 409 `PEDIDO_REPETIDO` quando o mesmo cliente fez um pedido igual há pouco; o checkout
// pergunta e, no "sim", manda de novo com `confirmarRepetido`. Os dados do outro pedido só vêm a quem entrou pelo link
// ou pela conta — qualquer pessoa digita um telefone (V79).

export type PedidoRepetidoPergunta = {
  /** O cliente provou quem é: o servidor mandou o número, a hora e a situação do outro pedido. */
  provado: boolean;
  numero: string | null;
  hora: string | null;
  situacao: string | null;
};

const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** A pergunta a partir da recusa do servidor, ou nada quando a recusa é outra. */
export function perguntaDoRepetido(e: unknown): PedidoRepetidoPergunta | null {
  const err = e as { code?: unknown; details?: unknown } | null;
  if (!err || typeof err !== 'object' || err.code !== 'PEDIDO_REPETIDO') return null;
  const d = (err.details && typeof err.details === 'object' ? err.details : {}) as Record<string, unknown>;
  const numero = texto(d.numero);
  return { provado: !!numero, numero, hora: texto(d.hora), situacao: texto(d.situacao) };
}

/** O título do diálogo. */
export const tituloDoRepetido = (p: PedidoRepetidoPergunta) =>
  p.provado ? 'Você já fez um pedido igual' : 'Pedido igual a um que acabou de chegar';

/** O texto do diálogo: com o cliente identificado, o outro pedido; sem, nada dele. */
export function textoDoRepetido(p: PedidoRepetidoPergunta): string {
  if (!p.provado) return 'Acabamos de receber um pedido com estes mesmos itens e este telefone.';
  const quando = p.hora ? `Hoje às ${p.hora}` : 'Há pouco';
  return `${quando} você pediu estes mesmos itens (pedido nº ${p.numero})${p.situacao ? `, que está ${p.situacao}` : ''}.`;
}

/** O aviso depois do "Não, foi engano" (nada foi enviado). */
export function avisoDepoisDoNao(p: PedidoRepetidoPergunta): string {
  return p.provado && p.numero
    ? `Tudo certo: não fizemos outro pedido. O pedido nº ${p.numero} segue normalmente${p.situacao ? ` (${p.situacao})` : ''}.`
    : 'Tudo certo: não fizemos outro pedido.';
}
