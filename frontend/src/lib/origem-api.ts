// Endereço da API (com /api/v1) e a origem do tempo real (sem /api/v1), resolvidos pela MESMA regra. O tempo real tinha
// a conta dele (`NEXT_PUBLIC_API_URL ?? nuvem`): no build do servidor da loja esse valor vem VAZIO, o `??` mantinha o
// vazio, e o socket batia na porta do app (3001 → Next) e levava 404 — o KDS da loja nunca conectava ao tempo real (sem
// som de pedido novo, até 30 s de atraso, faixa "Sem conexão" fixa; auditoria do KDS, 20/10/2026).
//  • servidor da loja (NEXT_PUBLIC_EDGE=1), no navegador: o mesmo host que serviu o app (localhost, IP ou regem.local),
//    na porta da API (padrão 3002);
//  • nuvem, ou fora do navegador: NEXT_PUBLIC_API_URL — vazio vale o endereço da nuvem.
export type LocalDaPagina = { protocol: string; hostname: string } | null;
export type AmbienteDaApi = { edge?: string; apiUrl?: string; portaApi?: string };

export function baseDaApi(amb: AmbienteDaApi, local: LocalDaPagina): string {
  if (amb.edge === '1' && local) return `${local.protocol}//${local.hostname}:${amb.portaApi || '3002'}/api/v1`;
  return amb.apiUrl || 'https://api.dmsregem.com/api/v1';
}

export function origemDoTempoReal(base: string): string {
  return base.replace(/\/api\/v1\/?$/, '');
}
