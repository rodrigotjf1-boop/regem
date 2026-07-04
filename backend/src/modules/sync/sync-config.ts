// Config direcional do sync (ver docs/arquitetura-edge.md §2).
// Cada tabela tem um dono e uma direção. O cursor é o campo de delta.
export type Direcao = 'sobe' | 'desce' | 'ambos';
export type TabelaSync = {
  tabela: string;
  direcao: Direcao;
  cursor: 'created_at' | 'updated_at';
};

// v1: apenas tabelas com `tenant_id` direto + cursor confiável.
// (append-only / hard-deletes / produto_variacao etc. entram no endurecimento v2.)
export const TABELAS_SYNC: TabelaSync[] = [
  // Controle (nuvem → local)
  { tabela: 'unidade', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'setor', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'funcao', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'colaborador', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'turno', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'etiqueta', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'categoria_produto', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'produto', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'ficha_tecnica', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'bot_regra', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'feriado', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'tipo_ocorrencia', direcao: 'desce', cursor: 'updated_at' },
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

// Slice 2: push só do OPERACIONAL append-only ('sobe') — idempotente por id, sem update.
// ('ambos' precisa de LWW-update → slice 3.)
export const TABELAS_PUSH = new Set(
  TABELAS_SYNC.filter((t) => t.direcao === 'sobe').map((t) => t.tabela),
);

// Segurança: colunas NUNCA enviadas no pull (segredos). PIN de 4 dígitos + bcrypt é
// brute-forçável offline → não sai daqui. Auth offline de credencial fica p/ design futuro.
export const REDIGIR: Record<string, string[]> = {
  colaborador: ['senha_hash', 'pin_hash'],
};
