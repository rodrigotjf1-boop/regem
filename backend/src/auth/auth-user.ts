// Contexto do usuário autenticado, extraído do JWT em cada request.
export interface AuthUser {
  colaboradorId: string;
  tenantId: string;
  categoria: string; // 'presidente' | 'gerente' | 'supervisao' | 'execucao'
}
