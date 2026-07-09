// Permissões do RBAC configurável (perfil_acesso). O presidente edita estes toggles
// por perfil; os guards e serviços checam via `pode()`. `ver_financeiro` governa a
// exibição de valores em R$ (dashboard/relatórios/financeiro/estoque).

export type AcoesModulo = {
  ver: boolean;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
};

export interface Permissoes {
  ver_financeiro?: boolean;
  financeiro?: boolean; // módulo Financeiro (contas a pagar/receber, DRE)
  fiscal?: boolean; // módulo Fiscal (NFC-e / notas)
  ponto?: Partial<AcoesModulo>;
  estoque?: Partial<AcoesModulo>;
}

export type ModuloAcao = 'ponto' | 'estoque';

// Checa uma ação de módulo (ex.: pode(perm, 'estoque', 'criar')).
export function pode(
  perm: Permissoes | undefined | null,
  modulo: ModuloAcao,
  acao: keyof AcoesModulo,
): boolean {
  return !!perm?.[modulo]?.[acao];
}

// Perfis-base semeados por tenant (mesmos padrões da migration 069). Usados no
// onboarding (register) para novos tenants e como fallback quando um colaborador
// ainda não tem perfil associado.
export const PERFIS_PADRAO: {
  nome: string;
  nivel: string;
  loginWeb: boolean;
  permissoes: Permissoes;
}[] = [
  {
    nome: 'Presidente',
    nivel: 'presidente',
    loginWeb: true,
    permissoes: {
      ver_financeiro: true,
      financeiro: true,
      fiscal: true,
      ponto: { ver: true, criar: true, editar: true, excluir: true },
      estoque: { ver: true, criar: true, editar: true, excluir: true },
    },
  },
  {
    nome: 'Gerente',
    nivel: 'gerente',
    loginWeb: true,
    permissoes: {
      ver_financeiro: false,
      financeiro: false,
      fiscal: false,
      ponto: { ver: true, criar: true, editar: true, excluir: true },
      estoque: { ver: true, criar: true, editar: true, excluir: false },
    },
  },
  {
    nome: 'Supervisor',
    nivel: 'supervisao',
    loginWeb: true,
    permissoes: {
      ver_financeiro: false,
      financeiro: false,
      fiscal: false,
      ponto: { ver: true, criar: false, editar: true, excluir: false },
      estoque: { ver: true, criar: false, editar: true, excluir: false },
    },
  },
  {
    nome: 'Execução',
    nivel: 'execucao',
    loginWeb: false,
    permissoes: {
      ver_financeiro: false,
      financeiro: false,
      fiscal: false,
      ponto: { ver: false, criar: false, editar: false, excluir: false },
      estoque: { ver: false, criar: false, editar: false, excluir: false },
    },
  },
];

export const perfilPadrao = (nivel: string) =>
  PERFIS_PADRAO.find((p) => p.nivel === nivel) ??
  PERFIS_PADRAO[PERFIS_PADRAO.length - 1];
