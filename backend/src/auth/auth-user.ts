import type { Permissoes } from './permissoes';

// Contexto do usuário autenticado, extraído do JWT em cada request.
export interface AuthUser {
  colaboradorId: string;
  tenantId: string;
  categoria: string; // 'presidente' | 'gerente' | 'supervisao' | 'execucao' (= perfil.nivel)
  // Escopo (RBAC): supervisor é restrito ao seu setor; usuário com unidade é restrito a ela.
  setorId?: string | null;
  unidadeId?: string | null;
  // RBAC configurável: pacote de permissões do perfil de acesso associado.
  permissoes?: Permissoes;
}
