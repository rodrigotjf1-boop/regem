-- @cloud-only
-- 407 — "％ TAXAS E MARGEM" DE CADA LOJA (R3 F5 da Gestão do catálogo; protótipo mockups/regem-conciliacao-ifood.html, decisões
-- 7, 8 e 9): as taxas do iFood e da 99 (o plano, a comissão e o pagamento de cada jeito de entregar, a taxa fixa por
-- entrega, a base da comissão com promoção, a parte paga na entrega), o imposto (Simples pelo faturamento ou uma média), a
-- margem, a antecipação, a maquininha, a entrega da loja e os itens por pedido — o que a calculadora de preço usa.
--
-- catalogo_taxas — uma linha por loja; `taxas` no formato da calculadora (o servidor completa com os valores de referência
--   o que faltar, e confere cada número). `null` no faturamento, nos itens por pedido e na parte paga na entrega = "use o
--   número das vendas" (o Regem calcula na hora). Sem linha = os valores de referência.
--
-- ⚠️ SÓ NUVEM (como a conferência, mig 405): os números das vendas e a calculadora leem na nuvem; a tela do servidor da loja
--    pede à nuvem pela rota do token de sync (a tabela fica em SO_NUVEM no sync-daemon).
-- ⚠️ Pelo MCP do Supabase: nada que apague objeto (LIC-171). Idempotente. RLS ligada e SEM política (como a 405).
set local lock_timeout = '5s';

create table if not exists catalogo_taxas (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  unidade_id      uuid not null references unidade(id) on delete cascade,
  taxas           jsonb not null default '{}'::jsonb,
  atualizado_em   timestamptz not null default clock_timestamp(),
  atualizado_por  uuid                                   -- colaborador
);
create unique index if not exists uq_catalogo_taxas on catalogo_taxas (unidade_id);
create index if not exists idx_catalogo_taxas_tenant on catalogo_taxas (tenant_id);
alter table catalogo_taxas enable row level security;

-- Conferência (no mesmo Run): as 2 linhas têm de vir com `ok = true`.
select 'a tabela das taxas' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'catalogo_taxas' and column_name = 'taxas') as ok
union all
select 'uma por loja',
       exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'uq_catalogo_taxas');
