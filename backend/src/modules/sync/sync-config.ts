// Config direcional do sync (ver docs/arquitetura-edge.md §2).
// Cada tabela tem um dono e uma direção. O cursor é o campo de delta.
export type Direcao = 'sobe' | 'desce' | 'ambos';
export type TabelaSync = {
  tabela: string;
  direcao: Direcao;
  cursor: 'created_at' | 'updated_at';
  escopo?: 'tenant_id' | 'id'; // coluna que amarra ao tenant (empresa usa 'id')
};

// v1: apenas tabelas com `tenant_id` direto + cursor confiável.
// (append-only / hard-deletes / produto_variacao etc. entram no endurecimento v2.)
export const TABELAS_SYNC: TabelaSync[] = [
  // Controle (nuvem → local) — empresa 1º (pais antes dos filhos p/ FK); escopo por id.
  { tabela: 'empresa', direcao: 'desce', cursor: 'updated_at', escopo: 'id' },
  { tabela: 'unidade', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'setor', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'funcao', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'perfil_acesso', direcao: 'desce', cursor: 'updated_at' }, // pai do colaborador (RBAC)
  { tabela: 'colaborador', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'turno', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'etiqueta', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'categoria_produto', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'produto', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'ficha_tecnica', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'bot_regra', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'feriado', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'tipo_ocorrencia', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'cardapio_config', direcao: 'desce', cursor: 'updated_at' }, // horários (update por abertura) + config da loja offline
  // Bidirecional (LWW)
  { tabela: 'item_estoque', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'fornecedor', direcao: 'ambos', cursor: 'updated_at' },
  // Operacional (local → nuvem) — usadas no push (slice 2); cursor por criação.
  { tabela: 'movimento_estoque', direcao: 'sobe', cursor: 'created_at' },
  { tabela: 'ponto_marcacao', direcao: 'sobe', cursor: 'created_at' },
  { tabela: 'lancamento_caixa', direcao: 'sobe', cursor: 'created_at' },
  { tabela: 'audit_log', direcao: 'sobe', cursor: 'created_at' },
];

// O servidor local PUXA o que a nuvem manda pra baixo (desce/ambos).
export const TABELAS_PULL = TABELAS_SYNC.filter(
  (t) => t.direcao === 'desce' || t.direcao === 'ambos',
);

// Push: append-only ('sobe', on conflict do nothing) e LWW ('ambos', on conflict
// do update se a linha recebida for mais nova — ver venceLWW / arquitetura-edge §3).
export const TABELAS_PUSH_APPEND = new Set(
  TABELAS_SYNC.filter((t) => t.direcao === 'sobe').map((t) => t.tabela),
);
export const TABELAS_PUSH_LWW = new Set(
  TABELAS_SYNC.filter((t) => t.direcao === 'ambos').map((t) => t.tabela),
);
export function modoPush(tabela: string): 'append' | 'lww' | null {
  if (TABELAS_PUSH_APPEND.has(tabela)) return 'append';
  if (TABELAS_PUSH_LWW.has(tabela)) return 'lww';
  return null;
}

// Segurança: colunas NUNCA enviadas no pull.
// NOTA sobre auth offline (decidido 14/07/2026): o edge é um appliance ON-PREMISE
// do próprio cliente licenciado — ele PRECISA de senha_hash/pin_hash locais para
// autenticar login (senha) e PIN sem internet. Os hashes são bcrypt (mão única),
// enviados só ao edge daquele tenant, pela rota /sync autenticada por sync token, e
// o pgdata é local (dono NetworkService). É o mesmo modelo de qualquer sistema
// on-prem, que sempre guarda os próprios hashes. Por isso NÃO redigimos mais aqui.
// Deixe o mapa pronto para redigir segredos futuros (ex.: tokens de integração).
export const REDIGIR: Record<string, string[]> = {};
