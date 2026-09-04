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
  escalas?: Partial<AcoesModulo>; // CRUD (mig 145): execução só `ver`
  checklist?: boolean;
  mural?: boolean;
  guias?: boolean; // POP & guias + documentos/ciência
  vistoria?: boolean; // vistorias (Operação)
  desempenho?: boolean; // ocorrências / gamificação / ranking
  // Financeiro / Fiscal
  ver_financeiro?: boolean; // mostra valores em R$
  financeiro?: boolean; // módulo Financeiro (DRE / fluxo)
  formas_pagamento?: boolean; // formas de pagamento (delivery + balcão)
  clientes_exportar?: boolean; // exportar a base de clientes (dado sensível/LGPD)
  // App do Entregador (E0) — o que o entregador vê no app (padrão mínimo: só scan +
  // geo do endereço + contato). O lojista libera o resto por estas chaves.
  entregador_pedidos?: boolean; // ver a lista de pedidos
  entregador_taxas?: boolean; // relatório de taxas
  entregador_ganhos?: boolean; // resumo de ganhos
  entregador_tempo?: boolean; // média de tempo
  entregador_relatorio?: boolean; // relatório de entregas
  entregador_tipos?: boolean; // tipos de entrega
  fiscal?: boolean; // Notas fiscais (NFC-e)
  tef?: boolean; // TEF / maquininha
  fiscal_config?: boolean; // configuração fiscal
  // Gestão
  cadastros?: boolean;
  fichas?: boolean; // fichas técnicas (CMV)
  bot?: boolean; // Bot de suporte + inbox do WhatsApp
  desligamento?: boolean; // desligamento CLT (RH)
  loja?: boolean; // Configurações → Loja (perfil do estabelecimento)
  unidades?: boolean; // Configurações → Unidades (cadastro/edição de lojas da rede)
  ponto_gerencial?: boolean; // Gerenciamento de ponto (gerencial)
  producao_kds?: boolean;
  // RBAC fino de impressão/KDS (Fase 8). Ausência herda `producao_kds` (ver
  // PERM_FALLBACK) — compat com perfis salvos antes destas chaves.
  impressoras?: boolean; // cadastro/edição de impressoras
  kds?: boolean; // cadastro/config de KDS (etapa, cadeia, cores)
  direcionamento_impressao?: boolean; // direcionar produtos/opções → KDS/impressora
  cupom_layout?: boolean; // editor de layout/perfis de cupom
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

export type ModuloAcao = 'ponto' | 'estoque' | 'escalas';

// PACOTE FIXO da sessão de SUPORTE (F9) — imposto pelo SERVIDOR, nunca vem do token.
// Least privilege: só CONFIG (impressão/KDS/direcionamento/cupom) + visão geral.
// NÃO inclui financeiro (R$), PII de cliente (delivery/pedidos mostram nome/telefone),
// vendas, cadastro de pessoas, ponto, estoque, relatórios, auditoria, acessos.
export const PACOTE_SUPORTE: Permissoes = {
  impressoras: true,
  kds: true,
  direcionamento_impressao: true,
  cupom_layout: true,
  producao_kds: true,
  servidor: true,
  loja: true, // Configurações → Loja/config técnica (perfil do estabelecimento; sem PII de cliente)
  dashboard: true, // visão geral, sem detalhe financeiro (governado por ver_financeiro=false)
};

// PACOTE TOTAL da sessão de SUPORTE (F9 · D) — usado SÓ quando o presidente da loja
// concede acesso total (empresa.suporte_acesso_total=true), para ajudar com config
// local/nuvem. Ainda imposto pelo SERVIDOR (nunca do token) e AUDITADO. Não muda a
// categoria (segue 'suporte'): a blindagem C&O/distribuição por categoria continua
// valendo — "total" cobre os módulos da própria loja, não a Visão C&O da distribuição.
const CRUD_TOTAL = { ver: true, criar: true, editar: true, excluir: true };
export const PACOTE_SUPORTE_TOTAL: Permissoes = {
  // Operação
  dashboard: true, pdv: true, mesas: true, cupons: true,
  // Delivery
  delivery: true, pedidos: true, fidelidade: true, cashback: true,
  // Rotina
  meu_dia: true, manutencao: true, escalas: CRUD_TOTAL, checklist: true, mural: true,
  guias: true, vistoria: true, desempenho: true,
  // Financeiro / Fiscal
  ver_financeiro: true, financeiro: true, formas_pagamento: true, clientes_exportar: true,
  fiscal: true, tef: true, fiscal_config: true,
  // Entregador (o que o app do entregador mostra — irrelevante p/ suporte, mas total)
  entregador_pedidos: true, entregador_taxas: true, entregador_ganhos: true,
  entregador_tempo: true, entregador_relatorio: true, entregador_tipos: true,
  // Gestão
  cadastros: true, fichas: true, bot: true, desligamento: true, loja: true, unidades: true,
  ponto_gerencial: true, producao_kds: true,
  // Config de impressão/KDS
  impressoras: true, kds: true, direcionamento_impressao: true, cupom_layout: true,
  config_ramo: true, planos: true, acessos: true, servidor: true,
  // Relatórios
  turnos: true, relatorios_vendas: true, cancelamentos: true,
  // Diretoria (visao_co segue barrada pela categoria='suporte' — flag aqui é inócua)
  auditoria: true, visao_co: true,
  // CRUD fino
  ponto: CRUD_TOTAL, estoque: CRUD_TOTAL,
};

// Checa uma ação de módulo (ex.: pode(perm, 'estoque', 'criar')).
export function pode(
  perm: Permissoes | undefined | null,
  modulo: ModuloAcao,
  acao: keyof AcoesModulo,
): boolean {
  return !!perm?.[modulo]?.[acao];
}

// ===== Hierarquia de níveis (RBAC de criação/edição) =====
// Fonte única da verdade para "quem pode criar/editar/atribuir qual nível".
// Usado por colaborador.service (criar/editar/reset de senha) e funcao.service
// (categoria da função) — antes duplicado só no colaborador, o que abria a
// escalada gerente→presidente por função (auditoria ago/2026, CL-1/CL-2).
export const NIVEL: Record<string, number> = {
  presidente: 4,
  gerente: 3,
  supervisao: 2,
  execucao: 1,
};

// O ator pode CRIAR/ATRIBUIR o nível-alvo? Presidente só é criado por presidente
// (sociedade); os demais exigem o ator ESTRITAMENTE acima do alvo.
export function podeCriarNivel(ator: string, alvo: string): boolean {
  if (alvo === 'presidente') return ator === 'presidente';
  return (NIVEL[ator] ?? 0) > (NIVEL[alvo] ?? 0);
}

// O ator pode EDITAR/RESETAR um alvo que JÁ EXISTE nesse nível? Não se o alvo
// estiver no mesmo nível ou acima — exceto presidente sobre presidente (sócios).
export function podeEditarNivel(ator: string, alvoAtual: string): boolean {
  if (alvoAtual === 'presidente') return ator === 'presidente';
  return (NIVEL[ator] ?? 0) > (NIVEL[alvoAtual] ?? 0);
}

// Chaves finas (Fase 8) que, quando AUSENTES do perfil salvo, herdam a permissão
// da chave-pai — mantém compat com perfis criados antes destas chaves existirem.
// (Se a chave existir e for `false`, respeita o `false` — o presidente desligou.)
export const PERM_FALLBACK: Partial<Record<keyof Permissoes, (keyof Permissoes)[]>> = {
  impressoras: ['producao_kds', 'servidor'],
  kds: ['producao_kds', 'servidor'],
  direcionamento_impressao: ['producao_kds', 'servidor', 'loja'],
  cupom_layout: ['producao_kds', 'loja', 'delivery'],
};

// Checa um toggle booleano do catálogo (ex.: podeAcessar(perm, 'financeiro')).
// Para chaves CRUD (ponto/estoque) considera o `ver`.
export function podeAcessar(
  perm: Permissoes | undefined | null,
  chave: keyof Permissoes,
): boolean {
  const v = perm?.[chave];
  // Chave fina AUSENTE → herda de qualquer uma das chaves-pai (compat, Fase 8).
  // Se a chave existir (mesmo `false`), respeita — o presidente desligou de propósito.
  if (v === undefined && PERM_FALLBACK[chave]) return PERM_FALLBACK[chave]!.some((p) => podeAcessar(perm, p));
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
  { chave: 'clientes_exportar', rotulo: 'Exportar base de clientes (LGPD)', grupo: 'Delivery', tipo: 'bool' },
  { chave: 'pedidos', rotulo: 'Pedidos · produção', grupo: 'Delivery', tipo: 'bool' },
  { chave: 'fidelidade', rotulo: 'Fidelidade', grupo: 'Delivery', tipo: 'bool' },
  { chave: 'cashback', rotulo: 'Cashback', grupo: 'Delivery', tipo: 'bool' },
  { chave: 'entregador_pedidos', rotulo: 'Entregador · ver pedidos', grupo: 'Entregador (app)', tipo: 'bool' },
  { chave: 'entregador_taxas', rotulo: 'Entregador · relatório de taxas', grupo: 'Entregador (app)', tipo: 'bool' },
  { chave: 'entregador_ganhos', rotulo: 'Entregador · resumo de ganhos', grupo: 'Entregador (app)', tipo: 'bool' },
  { chave: 'entregador_tempo', rotulo: 'Entregador · média de tempo', grupo: 'Entregador (app)', tipo: 'bool' },
  { chave: 'entregador_relatorio', rotulo: 'Entregador · relatório de entregas', grupo: 'Entregador (app)', tipo: 'bool' },
  { chave: 'entregador_tipos', rotulo: 'Entregador · tipos de entrega', grupo: 'Entregador (app)', tipo: 'bool' },
  { chave: 'meu_dia', rotulo: 'Tarefas', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'manutencao', rotulo: 'Pedidos de manutenção', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'escalas', rotulo: 'Escalas', grupo: 'Rotina', tipo: 'crud' },
  { chave: 'estoque', rotulo: 'Estoque', grupo: 'Rotina', tipo: 'crud' },
  { chave: 'checklist', rotulo: 'Checklist & registros', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'mural', rotulo: 'Mural & clima', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'guias', rotulo: 'POP & guias', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'vistoria', rotulo: 'Vistorias', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'desempenho', rotulo: 'Desempenho & ocorrências', grupo: 'Rotina', tipo: 'bool' },
  { chave: 'ver_financeiro', rotulo: 'Ver valores em R$', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'financeiro', rotulo: 'Financeiro (DRE)', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'formas_pagamento', rotulo: 'Formas de pagamento', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'fiscal', rotulo: 'Notas fiscais', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'tef', rotulo: 'TEF / maquininha', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'fiscal_config', rotulo: 'Configuração fiscal', grupo: 'Financeiro / Fiscal', tipo: 'bool' },
  { chave: 'cadastros', rotulo: 'Cadastros', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'fichas', rotulo: 'Fichas técnicas', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'bot', rotulo: 'Bot & WhatsApp', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'desligamento', rotulo: 'Desligamento (RH)', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'loja', rotulo: 'Loja (perfil)', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'unidades', rotulo: 'Unidades (lojas da rede)', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'ponto_gerencial', rotulo: 'Gerenciamento de ponto', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'ponto', rotulo: 'Ponto (ações)', grupo: 'Gestão', tipo: 'crud' },
  { chave: 'producao_kds', rotulo: 'Produção & KDS', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'impressoras', rotulo: 'Impressoras (cadastro)', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'kds', rotulo: 'KDS (config)', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'direcionamento_impressao', rotulo: 'Direcionamento de impressão', grupo: 'Gestão', tipo: 'bool' },
  { chave: 'cupom_layout', rotulo: 'Layout/perfis de cupom', grupo: 'Gestão', tipo: 'bool' },
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
    permissoes: { ...bools(TODAS_BOOL), ponto: CRUD_ALL, estoque: CRUD_ALL, escalas: CRUD_ALL },
  },
  {
    nome: 'Gerente',
    nivel: 'gerente',
    loginWeb: true,
    permissoes: {
      ...bools([
        'dashboard', 'pdv', 'mesas', 'cupons', 'delivery', 'pedidos', 'fidelidade',
        'cashback', 'meu_dia', 'manutencao', 'checklist', 'mural', 'cadastros', 'loja',
        'formas_pagamento', 'ponto_gerencial', 'producao_kds', 'servidor',
        'impressoras', 'kds', 'direcionamento_impressao', 'cupom_layout',
        'fichas', 'bot', 'desligamento', 'guias', 'vistoria', 'desempenho',
      ]),
      ponto: CRUD_ALL,
      estoque: { ver: true, criar: true, editar: true, excluir: false },
      escalas: CRUD_ALL,
    },
  },
  {
    nome: 'Supervisor',
    nivel: 'supervisao',
    loginWeb: true,
    permissoes: {
      ...bools([
        'pdv', 'mesas', 'cupons', 'delivery', 'pedidos', 'fidelidade', 'cashback',
        'checklist', 'mural', 'manutencao', 'fichas', 'guias', 'vistoria', 'desempenho',
      ]),
      ponto: { ver: true, criar: false, editar: true, excluir: false },
      estoque: { ver: true, criar: false, editar: true, excluir: false },
      escalas: { ver: true, criar: false, editar: true, excluir: false },
    },
  },
  {
    nome: 'Execução',
    nivel: 'execucao',
    // (mig 141) Passa a acessar pelo login: o atendente opera PDV/mesas/pedidos o
    // turno inteiro — as permissões abaixo já diziam isso, só o acesso estava
    // fechado. Sem isso ele trabalharia na sessão de outra pessoa e toda a
    // auditoria de caixa ficaria no nome de quem abriu o navegador.
    // Continua editável por perfil: quem quiser um perfil só-terminal desmarca.
    loginWeb: true,
    permissoes: {
      ...bools(['pdv', 'mesas', 'cupons', 'pedidos', 'checklist', 'mural', 'manutencao', 'guias', 'vistoria']),
      ponto: CRUD_NONE,
      estoque: CRUD_NONE,
      // Execução só VISUALIZA a escala (a escala é a fonte da verdade do dia dele);
      // criar/editar/excluir fica com supervisão+.
      escalas: { ver: true, criar: false, editar: false, excluir: false },
    },
  },
];

export const perfilPadrao = (nivel: string) =>
  PERFIS_PADRAO.find((p) => p.nivel === nivel) ??
  PERFIS_PADRAO[PERFIS_PADRAO.length - 1];
