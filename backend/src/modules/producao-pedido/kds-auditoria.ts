// AUDITORIA DO KDS (pedido do dono, 02/10/2026) — o que fica na trilha imutável e aparece no
// "Histórico" da tela do KDS.
//
// Entram as ações de CONSEQUÊNCIA: limpar a fila inteira, cancelar pedido em produção, mudar as
// etapas/cores, o período da senha, os destinos de produção, e criar/editar/excluir/disparar
// alerta. O toque de avançar UM card NÃO entra aqui de propósito: são centenas por dia por loja
// — na trilha encadeada (um registro por vez por empresa, conferida inteira no "verificar")
// afogariam os eventos de governança.

/** Quem fez, para a auditoria (vem do usuário logado, no controller). */
export type AtorKds = { id: string; perfil: string };

/** As ações que o histórico do KDS mostra. */
export const ACOES_KDS = [
  'limpou_fila_kds',
  'cancelou_pedido_producao',
  'alterou_etapas_kds',
  'alterou_periodo_senha',
  'alterou_destinos_producao',
  'criou_alerta_kds',
  'editou_alerta_kds',
  'excluiu_alerta_kds',
  'disparou_alerta_kds',
] as const;
