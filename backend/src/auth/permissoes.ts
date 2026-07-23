// Permissões do RBAC configurável (perfil_acesso). O presidente edita estes toggles
// por perfil (e pode criar novos perfis); os guards e serviços checam via `pode()`
// (ações CRUD) ou pelo booleano direto. `ver_financeiro` governa a exibição de
// valores em R$ (dashboard/relatórios/financeiro/estoque).

export type AcoesModulo = {
  ver: boolean;
  criar: boolean;
  editar: boolean;
  excluir: boolean;
};

// Permissões booleanas de acesso a área do menu. Ausência = negado (exceto
// presidente, que tem tudo por padrão). `ponto`/`estoque` guardam ações CRUD.
export interface Permissoes {
  // Operação
  dashboard?: boolean;
  pdv?: boolean;
  mesas?: boolean;
  cupons?: boolean;
  // Delivery
  delivery?: boolean;
  pedidos?: boolean;
  fidelidade?: boolean;
  cashback?: boolean;
  // Rotina
  meu_dia?: boolean;
  manutencao?: boolean; // pedidos de manutenção (mig 134)
  escalas?: boolean;
  checklist?: boolean;
  mural?: boolean;
  // Financeiro / Fiscal
  ver_financeiro?: boolean; // mostra valores em R$
  financeiro?: boolean; // módulo Financeiro (DRE / fluxo)
  formas_pagamento?: boolean; // formas de pagamento (delivery + balcão)
  fiscal?: boolean; // Notas fiscais (NFC-e)
  tef?: boolean; // TEF / maquininha
  fiscal_config?: boolean; // configuração fiscal
  // Gestão
  cadastros?: boolean;
  loja?: boolean; // Configurações → Loja (perfil do estabelecimento)
  unidades?: boolean; // Configurações → Unidades (cadastro/edição de lojas da rede)
  ponto_gerencial?: boolean; // Gerenciamento de ponto (gerencial)
  producao_kds?: boolean;
  config_ramo?: boolean; // config por ramo (wizard)
  planos?: boolean; // planos & assinatura
  acessos?: boolean; // acessos & perfis
  servidor?: boolean; // servidor local (edge)
  // Relatórios
  turnos?: boolean; // turnos / fechamentos de caixa
  relatorios_vendas?: boolean;
  cancelamentos?: boolean; // cancelamentos de itens de mesa (retiradas)
  // Diretoria
  auditoria?: boolean;
  visao_co?: boolean;
  // Ações CRUD por módulo (controle fino dentro da tela)
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

// Checa um toggle booleano do catálogo (ex.: podeAcessar(perm, 'financeiro')).
// Para chaves CRUD (ponto/estoque) considera o `ver`.
export function podeAcessar(
  perm: Permissoes | undefined | null,
  chave: keyof Permissoes,
): boolean {
  const v = perm?.[chave];
  return typeof v === 'object' ? !!(v as Partial<AcoesModulo>).ver : !!v;
}

// ===== Catálogo (para o editor de perfis e para a navegação por permissão) =====
export type CatalogoItem = {
  chave: keyof Permissoes;
  rotulo: string;
  grupo: string;
  tipo: 'bool' | 'crud';
};

export const CATALOGO_PERMISSOES: CatalogoItem[] = [
  { chave: 'dashboard', rotulo: 'Dashboard', grupo: 'Operação', tipo: 'bool' },
  { chave: 'pdv', rotulo: 'PDV · Balcão', grupo: 'Operação', tipo: 'bool' },
  { chave: 'mesas', rotulo: 'Mesas e comandas', grupo: 'Operação', tipo: 'bool' },
  { chave: 'cupons', rotulo: 'Cupons', grupo: 'Operação', tipo: 'bool' },
  { chave: 'delivery', rotulo: 'Delivery', grupo: 'Delivery', tipo: 'bool' },
  { chave: 'pedidos', rotulo: 'Pedidos · produção', grupo: 'Delivery', tipo: 'bool' },
  { chave: 'fidelidade', rotulo: 'Fidelidade', grupo: 'Delivery', tipo: 'bool' },
  { chave: 'cashback', rotulo: 'Cashback', grupo: 'Delivery', tipo: 'bool' },
  { chave: 'meu_dia', rotulo: 'Tarefas', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'manutencao', rotulo: 'Pedidos de manutenção', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'escalas', rotulo: 'Escalas', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'estoque', rotulo: 'Estoque', grupo: 'Rotina', tipo: 'crud' },
  { chave: 'checklist', rotulo: 'Checklist & registros', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'mural', rotulo: 'Mural & clima', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'ver_financeiro', rotulo: 'Ver valores em R$', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'financeiro', rotulo: 'Financeiro (DRE)', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'formas_pagamento', rotulo: 'Formas de pagamento', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'fiscal', rotulo: 'Notas fiscais', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'tef', rotulo: 'TEF / maquininha', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'fiscal_config', rotulo: 'Configuração fiscal', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'cadastros', rotulo: 'Cadastros', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'loja', rotulo: 'Loja (perfil)', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'unidades', rotulo: 'Unidades (lojas da rede)', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'ponto_gerencial', rotulo: 'Gerenciamento de ponto', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'ponto', rotulo: 'Ponto (ações)', grupo: 'Gestão', tipo: 'crud' },
  { chave: 'producao_kds', rotulo: 'Produção & KDS', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'config_ramo', rotulo: 'Config. por ramo', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'planos', rotulo: 'Planos & assinatura', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'acessos', rotulo: 'Acessos & perfis', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'servidor', rotulo: 'Servidor local', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'turnos', rotulo: 'Turnos / caixa', grupo: 'Relatórios', tipo: 'bool' },
  { chave: 'relatorios_vendas', rotulo: 'Relatórios de vendas', grupo: 'Relatórios', tipo: 'bool' },
  { chave: 'cancelamentos', rotulo: 'Cancelamentos de itens', grupo: 'Relatórios', tipo: 'bool' },
  { chave: 'auditoria', rotulo: 'Auditoria', grupo: 'Diretoria', tipo: 'bool' },
  { chave: 'visao_co', rotulo: 'Visão C&O', grupo: 'Diretoria', tipo: 'bool' },
];

// Helpers para montar os defaults de forma legível.
const CRUD_ALL: AcoesModulo = { ver: true, criar: true, editar: true, excluir: true };
const CRUD_NONE: AcoesModulo = { ver: false, criar: false, editar: false, excluir: false };
const TODAS_BOOL = CATALOGO_PERMISSOES.filter((c) => c.tipo === 'bool').map((c) => c.chave);
const bools = (ativos: (keyof Permissoes)[]): Permissoes => {
  const o: Permissoes = {};
  for (const c of TODAS_BOOL) (o as Record<string, unknown>)[c as string] = false;
  for (const k of ativos) (o as Record<string, unknown>)[k as string] = true;
  return o;
};

// Perfis-base semeados por tenant (mesma matriz da migration 093). Usados no
// onboarding (register) e como fallback quando um colaborador ainda não tem perfil.
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
    permissoes: { ...bools(TODAS_BOOL), ponto: CRUD_ALL, estoque: CRUD_ALL },
  },
  {
    nome: 'Gerente',
    nivel: 'gerente',
    loginWeb: true,
    permissoes: {
      ...bools([
        'dashboard', 'pdv', 'mesas', 'cupons', 'delivery', 'pedidos', 'fidelidade',
        'cashback', 'meu_dia', 'manutencao', 'escalas', 'checklist', 'mural', 'cadastros', 'loja',
        'formas_pagamento', 'ponto_gerencial', 'producao_kds', 'servidor',
      ]),
      ponto: CRUD_ALL,
      estoque: { ver: true, criar: true, editar: true, excluir: false },
    },
  },
  {
    nome: 'Supervisor',
    nivel: 'supervisao',
    loginWeb: true,
    permissoes: {
      ...bools([
        'pdv', 'mesas', 'cupons', 'delivery', 'pedidos', 'fidelidade', 'cashback',
        'escalas', 'checklist', 'mural', 'manutencao',
      ]),
      ponto: { ver: true, criar: false, editar: true, excluir: false },
      estoque: { ver: true, criar: false, editar: true, excluir: false },
    },
  },
  {
    nome: 'Execução',
    nivel: 'execucao',
    loginWeb: false,
    permissoes: {
      ...bools(['pdv', 'mesas', 'cupons', 'pedidos', 'escalas', 'checklist', 'mural', 'manutencao']),
      ponto: CRUD_NONE,
      estoque: CRUD_NONE,
    },
  },
];

export const perfilPadrao = (nivel: string) =>
  PERFIS_PADRAO.find((p) => p.nivel === nivel) ??
  PERFIS_PADRAO[PERFIS_PADRAO.length - 1];
