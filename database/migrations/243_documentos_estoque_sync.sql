-- 243_documentos_estoque_sync.sql — Os DOCUMENTOS de estoque passam a sincronizar
-- entre o servidor local e a nuvem.
--
-- ⚠️ NÃO é @cloud-only: estas tabelas existem no edge e é lá que os documentos nascem.
-- Aplicar na nuvem E no edge.
--
-- POR QUÊ
-- `recebimento(_item)`, `lote`, `desperdicio`, `contagem_*` (4), `compra_lista/_item` e
-- `titulo_financeiro` NUNCA estiveram em `TABELAS_SYNC`. Os módulos que as escrevem
-- (Recebimento, Contagem, Compras, Desperdício) rodam no EDGE. Resultado: o documento
-- criado na loja fica só lá. O `movimento_estoque` sobe (o ledger sincroniza), então o
-- saldo bate — mas a ORIGEM some: a nuvem mostra estoque entrando sem dizer de qual nota,
-- de qual contagem, de qual perda.
--
-- Pior em `titulo_financeiro`: `recebimento.confirmar()` cria a CONTA A PAGAR ao
-- fornecedor. Ela nunca chegava à nuvem — quem abre o Financeiro não vê a dívida.
--
-- O QUE FALTAVA PARA PODER SINCRONIZAR
-- O sync transacional é LWW por `updated_at` + GATILHO que bumpa em todo UPDATE. É a
-- mesma razão escrita na mig 095: "sem isso, o append-only só capturaria a criação".
-- Destas 11 tabelas, 10 não tinham gatilho nenhum, 5 não tinham `updated_at` e 2 não
-- tinham timestamp algum. Sem o bump, a MUDANÇA DE ESTADO não propaga:
--   • contagem_execucao: 'aberta' → 'fechada' ficaria invisível do outro lado;
--   • titulo_financeiro: 'aberto' → 'pago' idem — a nuvem mostraria a conta em aberto
--     para sempre depois de a loja pagar.
--
-- Nenhuma delas sofre DELETE físico no código (conferido), então não precisam de
-- `deleted_at` para propagar exclusão; as que já têm usam para a própria listagem.

-- ===== 1. Colunas de tempo que faltavam =====
alter table contagem_lista_item add column if not exists created_at timestamptz not null default now();
alter table compra_item         add column if not exists created_at timestamptz not null default now();

alter table recebimento_item    add column if not exists updated_at timestamptz not null default now();
alter table contagem_lista_item add column if not exists updated_at timestamptz not null default now();
alter table contagem_execucao   add column if not exists updated_at timestamptz not null default now();
alter table contagem_item       add column if not exists updated_at timestamptz not null default now();
alter table compra_item         add column if not exists updated_at timestamptz not null default now();
alter table titulo_financeiro   add column if not exists updated_at timestamptz not null default now();

-- ===== 2. Gatilho de bump em TODAS as 11 =====
-- `bump_updated_at()` vem da mig 095 (base, existe no edge). `desperdicio` já tem o seu
-- (`trg_desperdicio_updated`, mesma semântica) e fica como está.
do $$
declare t text;
begin
  foreach t in array array[
    'recebimento','recebimento_item','lote',
    'contagem_lista','contagem_lista_item','contagem_execucao','contagem_item',
    'compra_lista','compra_item','titulo_financeiro'
  ] loop
    execute format('drop trigger if exists trg_bump_updated_at on %I', t);
    execute format('create trigger trg_bump_updated_at before update on %I '
                   || 'for each row execute function bump_updated_at()', t);
  end loop;
end $$;

-- ===== 3. Índices do KEYSET do pull/push =====
-- O delta ordena por (tenant_id, updated_at, id) por tabela, a cada ciclo (1 min) em
-- toda loja com edge. Sem índice, vira seq scan.
create index if not exists idx_recebimento_sync        on recebimento (tenant_id, updated_at, id);
create index if not exists idx_recebimento_item_sync   on recebimento_item (tenant_id, updated_at, id);
create index if not exists idx_lote_sync               on lote (tenant_id, updated_at, id);
create index if not exists idx_desperdicio_sync        on desperdicio (tenant_id, updated_at, id);
create index if not exists idx_contagem_lista_sync     on contagem_lista (tenant_id, updated_at, id);
create index if not exists idx_contagem_lista_item_sync on contagem_lista_item (tenant_id, updated_at, id);
create index if not exists idx_contagem_execucao_sync  on contagem_execucao (tenant_id, updated_at, id);
create index if not exists idx_contagem_item_sync      on contagem_item (tenant_id, updated_at, id);
create index if not exists idx_compra_lista_sync       on compra_lista (tenant_id, updated_at, id);
create index if not exists idx_compra_item_sync        on compra_item (tenant_id, updated_at, id);
create index if not exists idx_titulo_financeiro_sync  on titulo_financeiro (tenant_id, updated_at, id);
