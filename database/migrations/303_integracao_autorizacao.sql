-- @cloud-only
-- 303_integracao_autorizacao.sql — Autorização PELA LOJA (trilha C, C1b): o presidente autoriza
-- o Liame na página "Autorizar o Liame" (`/integracoes/autorizar`) e o Liame troca o código pelo
-- token de cada loja, entre servidores.
--
-- O QUE ENTRA
--   `integracao_autorizacao`: o CÓDIGO da autorização (uso único, 10 minutos), guardado só em
--   hash (SHA-256), com o que o presidente escolheu: as lojas e os escopos. O token da loja
--   (`integracao_token_loja`, mig 295) só nasce na troca do código — se a troca não acontece, o
--   código vence e nada foi liberado.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. A tabela nunca existe lá e o módulo
--    que a usa não sobe no servidor da loja.
-- ⚠️ DEPENDE da 295. Aplicar na NUVEM ANTES do merge (V9e): a página lê e grava a tabela.
-- Idempotente. Tabela nova e vazia; a chave estrangeira para `empresa` só olha a tabela (o
-- `lock_timeout` faz a migration desistir em vez de enfileirar escrita atrás dela).
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null then
    raise exception 'A 303 depende da 295 (integracao_token_loja): aplique-a antes.';
  end if;
end $$;

create table if not exists integracao_autorizacao (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references empresa(id) on delete cascade,
  cliente             text not null,                 -- 'liame'
  codigo_hash         text not null unique,          -- sha256 (hex) do código; o código em si nunca é gravado
  desafio             text not null,                 -- code_challenge do PKCE (S256), conferido na troca
  redirect_uri        text not null,                 -- o endereço de volta DESTE pedido (tem de ser o mesmo na troca)
  lojas               uuid[] not null,               -- as lojas que o presidente marcou
  escopos             text[] not null,               -- o que ele liberou (igual para todas as lojas marcadas)
  autorizado_por      uuid not null,                 -- colaborador (presidente)
  autorizado_por_nome text not null,
  criado_em           timestamptz not null default now(),
  expira_em           timestamptz not null,          -- criado_em + 10 minutos
  usado_em            timestamptz,                   -- a primeira tentativa de troca gasta o código, dando certo ou não
  constraint ck_integracao_autorizacao_lojas check (cardinality(lojas) between 1 and 200),
  constraint ck_integracao_autorizacao_escopos check (
    cardinality(escopos) > 0
    and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                         'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                         'cupons.criar', 'clientes.ler', 'vendas.99food.ler']::text[]
  ),
  constraint ck_integracao_autorizacao_validade check (expira_em > criado_em)
);

-- Limpeza dos códigos vencidos (feita pela própria rota, a cada autorização).
create index if not exists idx_integracao_autorizacao_expira
  on integracao_autorizacao (expira_em);

-- Hash do código e o desafio: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM
-- política, como a 295 (o app usa um papel que atravessa a RLS; a troca procura o código antes de
-- saber a empresa).
alter table integracao_autorizacao enable row level security;

-- Conferência no MESMO Run: as cinco linhas têm de vir com `ok = true`.
select 'tabela integracao_autorizacao' as objeto,
       to_regclass(current_schema() || '.integracao_autorizacao') is not null as ok
union all
select 'índice único do codigo_hash',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'integracao_autorizacao'
                  and indexdef ilike '%unique%(codigo_hash)%')
union all
select 'índice da validade',
       to_regclass(current_schema() || '.idx_integracao_autorizacao_expira') is not null
union all
select 'RLS ligada',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.integracao_autorizacao')), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
