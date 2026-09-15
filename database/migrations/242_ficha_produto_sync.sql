-- 242_ficha_produto_sync.sql — Torna a CADEIA DA FICHA sincronizável para o edge.
--
-- ⚠️ NÃO é @cloud-only: estas tabelas existem no edge desde as migs 007/021 e é
-- justamente LÁ que elas precisam chegar. Aplicar na nuvem E no edge.
--
-- POR QUÊ
-- A explosão de ficha (vendas.service → acumularFicha) lê `ficha_ingrediente`,
-- `produto_combo_item` e `produto_variacao`. Nenhuma das três está na whitelist do
-- sync (`TABELAS_SYNC`), então no servidor local a ficha desce VAZIA: a venda não
-- baixa insumo nenhum, o saldo congela e — porque `consumo.size === 0` é tratado como
-- "ilimitado" — nada nunca esgota.
--
-- Só adicionar à whitelist não resolve: o sync é delta POR LINHA e estas tabelas não
-- tinham cursor de mudança nem marca de exclusão. Como a ficha é salva por
-- DELETE + INSERT, o edge receberia as linhas novas e ficaria com as antigas para
-- sempre — trocando "baixa zero" por "baixa duplicada", que é pior de diagnosticar.
--
-- Esta migration dá às três tabelas o mesmo contrato das outras tabelas sincronizadas:
--   • updated_at + gatilho  → cursor de delta (o sync anda por ele)
--   • deleted_at            → exclusão PROPAGA (o padrão do projeto desde a mig 118)
-- `produto_combo_item` não tinha sequer created_at.
--
-- Nenhuma das três tem índice único, então soft-delete não conflita com re-inserção.

-- ===== ficha_ingrediente =====
alter table ficha_ingrediente add column if not exists updated_at timestamptz not null default now();
alter table ficha_ingrediente add column if not exists deleted_at timestamptz;

-- ===== produto_variacao =====
alter table produto_variacao add column if not exists updated_at timestamptz not null default now();
alter table produto_variacao add column if not exists deleted_at timestamptz;

-- ===== produto_combo_item (não tinha nenhum timestamp) =====
alter table produto_combo_item add column if not exists created_at timestamptz not null default now();
alter table produto_combo_item add column if not exists updated_at timestamptz not null default now();
alter table produto_combo_item add column if not exists deleted_at timestamptz;

-- Gatilho de updated_at (set_updated_at() vem da 001_base, existe no edge).
-- `create trigger` não tem IF NOT EXISTS → drop antes, como nas migs 023/092/095.
drop trigger if exists trg_ficha_ingrediente_updated on ficha_ingrediente;
create trigger trg_ficha_ingrediente_updated before update on ficha_ingrediente
  for each row execute function set_updated_at();

drop trigger if exists trg_produto_variacao_updated on produto_variacao;
create trigger trg_produto_variacao_updated before update on produto_variacao
  for each row execute function set_updated_at();

drop trigger if exists trg_produto_combo_item_updated on produto_combo_item;
create trigger trg_produto_combo_item_updated before update on produto_combo_item
  for each row execute function set_updated_at();

-- Índices do KEYSET do pull: o delta ordena por (cursor, id) por tabela.
-- Sem eles o pull faz seq scan a cada ciclo (1 min) em toda loja com edge.
create index if not exists idx_ficha_ingrediente_sync
  on ficha_ingrediente (tenant_id, updated_at, id);
create index if not exists idx_produto_variacao_sync
  on produto_variacao (tenant_id, updated_at, id);
create index if not exists idx_produto_combo_item_sync
  on produto_combo_item (tenant_id, updated_at, id);

-- Leituras filtram `deleted_at is null`; índice parcial mantém o caminho quente barato.
create index if not exists idx_ficha_ingrediente_ficha_vivo
  on ficha_ingrediente (ficha_id) where deleted_at is null;
create index if not exists idx_produto_variacao_produto_vivo
  on produto_variacao (produto_id) where deleted_at is null;
create index if not exists idx_produto_combo_item_pai_vivo
  on produto_combo_item (combo_produto_id) where deleted_at is null;
