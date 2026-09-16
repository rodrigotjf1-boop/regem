-- 248_movimento_lote.sql — De qual LOTE saiu cada baixa de estoque.
--
-- ⚠️ NÃO é @cloud-only: a baixa acontece no edge (Vendas, Produção, Desperdício e
-- Contagem são EDGE_CORE). Aplicar na nuvem E no edge.
--
-- POR QUÊ
-- `lote.quantidade` era gravado na entrada e NUNCA decrementado — o próprio código
-- admitia ("saídas ainda não decrementam lotes; usa lote.quantidade como saldo
-- aproximado"). Consequência: a tela de validades e o alerta das 06:10 mostram a
-- quantidade de quando a mercadoria chegou. O lote de 10 kg já todo consumido continua
-- avisando "vence em 2 dias, 10 kg" — o alerta perde credibilidade e o lojista para de
-- olhar, que é pior do que não ter alerta.
--
-- POR QUE UMA TABELA, E NÃO UM UPDATE EM `lote.quantidade`
-- `lote` sincroniza como 'ambos' com LWW (mig 243). Um SALDO MUTÁVEL sob LWW perde
-- baixa: se a loja consome 3 e a nuvem consome 2 do mesmo lote, a última escrita vence
-- e uma das duas some. É a mesma razão pela qual o saldo do estoque nunca foi um campo
-- e sim a SOMA do ledger `movimento_estoque`.
--
-- Então: `lote.quantidade` passa a significar o que ENTROU (imutável) e o consumo é a
-- soma desta tabela, que é APPEND-ONLY e sobe igual ao `movimento_estoque` ('sobe',
-- cursor `created_at`, espelhada de volta em TABELAS_PULL_APPEND). Duas baixas
-- simultâneas viram duas linhas e as duas contam.
--
--   saldo_do_lote = lote.quantidade − coalesce(sum(movimento_lote.quantidade), 0)
--
-- Serve também ao que o dono pediu desde o começo: dado um lote com problema, esta
-- tabela diz exatamente QUAIS saídas o consumiram (e, pela `ref` do movimento, quais
-- vendas/produções/perdas) — sem abrir embalagem.
--
-- Estorno: a venda cancelada devolve ao lote de ORIGEM, lendo as linhas do movimento
-- original e gravando o negativo. Sem isso, o estorno devolveria ao estoque geral e o
-- lote ficaria consumido para sempre.

create table if not exists movimento_lote (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  -- Sem FK para `movimento_estoque`/`lote` de propósito: o sync insere linha a linha e
  -- a ordem de chegada entre tabelas não é garantida (o daemon já tem retry de 23503,
  -- mas uma FK aqui transformaria atraso de replicação em linha perdida).
  movimento_id uuid not null,
  lote_id uuid not null,
  -- POSITIVO = consumiu do lote; NEGATIVO = devolveu (estorno).
  quantidade numeric not null,
  created_at timestamptz not null default now()
);

-- "O que consumiu este lote" (recall) e "de onde saiu este movimento" (estorno).
create index if not exists idx_movimento_lote_lote on movimento_lote (tenant_id, lote_id);
create index if not exists idx_movimento_lote_mov  on movimento_lote (movimento_id);
-- Keyset do sync append-only, igual ao de `movimento_estoque`.
create index if not exists idx_movimento_lote_sync on movimento_lote (tenant_id, created_at, id);
