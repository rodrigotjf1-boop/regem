// Config direcional do sync (ver docs/arquitetura-edge.md §2).
// Cada tabela tem um dono e uma direção. O cursor é o campo de delta.
export type Direcao = 'sobe' | 'desce' | 'ambos';
export type TabelaSync = {
  tabela: string;
  direcao: Direcao;
  cursor: 'created_at' | 'updated_at' | 'criado_em';
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
  // Categoria: BIDIRECIONAL (P3 completo) — editada no edge, espelha na nuvem.
  { tabela: 'categoria_produto', direcao: 'ambos', cursor: 'updated_at' },
  // Produto é BIDIRECIONAL: no modo híbrido (local prioritário) o catálogo é editado
  // no edge; disponibilidade/esgotado/preço SOBEM para o cardápio ONLINE (nuvem) por
  // LWW (updated_at, bumpado em atualizar/sincronizarEsgotados). Flash-sync acelera.
  { tabela: 'produto', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'ficha_tecnica', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'bot_regra', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'feriado', direcao: 'desce', cursor: 'created_at' },
  { tabela: 'tipo_ocorrencia', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'cardapio_config', direcao: 'ambos', cursor: 'updated_at' }, // bidirecional: config/horários editados no edge sobem p/ o cardápio online
  // ── Catálogo reutilizável (P3 completo) — BIDIRECIONAL. Editado no edge (modo
  // híbrido) e espelhado na nuvem p/ o cardápio online + editor. LWW por updated_at,
  // exclusão por deleted_at (mig 118). Ordem: opção/complemento antes das ligações (FK).
  { tabela: 'opcao', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'complemento', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'complemento_item', direcao: 'ambos', cursor: 'updated_at' }, // liga complemento↔opção
  { tabela: 'produto_complemento', direcao: 'ambos', cursor: 'updated_at' }, // liga produto↔complemento
  // Complementos/opções do PRODUTO (materializados p/ o motor: PDV/garçom/cardápio).
  // BIDIRECIONAL (P3): a materialização local do edge SOBE p/ a nuvem servir o cardápio
  // online. Regeração/exclusão propaga por deleted_at; updated_at (mig 118) guia o push.
  { tabela: 'complemento_grupo', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'complemento_opcao', direcao: 'ambos', cursor: 'updated_at' },
  // Bidirecional (LWW)
  { tabela: 'item_estoque', direcao: 'ambos', cursor: 'updated_at' },
  { tabela: 'fornecedor', direcao: 'ambos', cursor: 'updated_at' },
  // Operacional (local → nuvem) — usadas no push (slice 2); cursor por criação.
  { tabela: 'movimento_estoque', direcao: 'sobe', cursor: 'created_at' },
  { tabela: 'ponto_marcacao', direcao: 'sobe', cursor: 'created_at' },
  { tabela: 'lancamento_caixa', direcao: 'sobe', cursor: 'created_at' },
  { tabela: 'audit_log', direcao: 'sobe', cursor: 'created_at' },
  // v2: transacionais SOBEM por LWW (mudam de estado) — cursor por updated_at
  // (bumpado por gatilho da mig 095). O push aplica update-se-mais-nova na nuvem.
  { tabela: 'caixa_sessao', direcao: 'sobe', cursor: 'updated_at' },
  { tabela: 'comanda', direcao: 'sobe', cursor: 'updated_at' },
  { tabela: 'comanda_item', direcao: 'sobe', cursor: 'updated_at' },
  { tabela: 'producao_pedido', direcao: 'sobe', cursor: 'updated_at' },
  { tabela: 'producao_pedido_item', direcao: 'sobe', cursor: 'updated_at' },
  // Pedido externo é BIDIRECIONAL (P1): pedidos ONLINE nascem na nuvem (cardápio/
  // marketplaces) e precisam DESCER para o edge processá-los localmente (KDS/garçom);
  // pedidos locais SOBEM. LWW por updated_at resolve conflito de estado.
  { tabela: 'pedido_externo', direcao: 'ambos', cursor: 'updated_at' },
];

// O servidor local PUXA o que a nuvem manda pra baixo (desce/ambos).
export const TABELAS_PULL = TABELAS_SYNC.filter(
  (t) => t.direcao === 'desce' || t.direcao === 'ambos',
);

// RESTAURAÇÃO (nuvem → edge, SÓ sob demanda): tabelas TRANSACIONAIS que podem ter
// sido criadas na NUVEM enquanto o edge esteve fora (operação no modo nuvem). Ao
// voltar pro local, o botão de restaurar PUXA essas tabelas por delta e faz UPSERT
// por id (aditivo — nunca apaga o que é só local). Ordem = pais antes dos filhos
// (o daemon ainda tem retry de FK como rede de segurança). NÃO é sync contínuo.
export const TABELAS_RESTORE: TabelaSync[] = [
  // Cursor por updated_at (v2) para trazer também MUDANÇAS DE ESTADO feitas na
  // nuvem durante a queda (ex.: comanda fechada), não só as criadas.
  { tabela: 'caixa_sessao', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'comanda', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'comanda_item', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'producao_pedido', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'producao_pedido_item', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'pedido_externo', direcao: 'desce', cursor: 'updated_at' },
  { tabela: 'lancamento_caixa', direcao: 'desce', cursor: 'created_at' }, // append (sem updated_at)
  { tabela: 'movimento_estoque', direcao: 'desce', cursor: 'created_at' }, // append
];

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
