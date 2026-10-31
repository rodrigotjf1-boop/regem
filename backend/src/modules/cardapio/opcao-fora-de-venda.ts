/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * ADICIONAL FORA DE VENDA (achado da Fase 5 do robô, 30/10/2026): a opção reutilizável de origem (`opcao`, mig 115) que a
 * loja marcou como esgotada ou desativou — ou que foi apagada — não pode ser oferecida nem vendida. Antes, o cardápio
 * materializado (`complemento_opcao`) não olhava para isso: o adicional esgotado continuava no cardápio e no pedido.
 * A MESMA regra para o cardápio (`menu`, não mostra) e para o pedido (`resolverOpcoes`, recusa) — V74.
 */
export function opcaoForaDeVenda(o: { ativo?: unknown; esgotado?: unknown; deletedAt?: unknown } | null | undefined): boolean {
  if (!o) return false; // sem opção de origem (grupo criado à mão no produto): vale o que está no produto
  return o.ativo === false || o.esgotado === true || o.deletedAt != null;
}
