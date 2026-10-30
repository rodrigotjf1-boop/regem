// OS PEDIDOS DO CLIENTE PARA O ROBÔ ("cadê meu pedido") — a rota já traz do mais novo ao mais velho; aqui cada um ganha
// a posição, a marca do mais recente e a hora em São Paulo. No teste de 29/10/2026 o robô respondeu "pedido 10" numa
// pergunta e "pedido 64" na outra: com a lista sem marca, cada resposta escolheu um. Só acrescenta campos — o robô
// antigo do n8n lê a mesma rota.

/** "29/10 21:43" (horário de São Paulo), ou null. */
export function horaDoPedido(v: unknown): string | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return null;
  return d
    .toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    .replace(',', '');
}

/** Os pedidos na ordem em que chegaram (o mais novo primeiro), com `ordem`, `maisRecente` e `criadoEmTexto`. */
export function pedidosParaORobo<T extends { criadoEm?: unknown }>(
  pedidos: T[],
): (T & { ordem: number; maisRecente: boolean; criadoEmTexto: string | null })[] {
  return pedidos.map((p, i) => ({ ...p, ordem: i + 1, maisRecente: i === 0, criadoEmTexto: horaDoPedido(p.criadoEm) }));
}
