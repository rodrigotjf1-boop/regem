-- @cloud-only
-- 295_integracao_token_loja.sql — Token de integração POR LOJA (trilha C, C1a).
--
-- Um sistema de fora (o Liame, primeiro) lê os dados de UMA loja com um token opaco
-- `rgm_it_…` que o banco guarda SÓ em hash (SHA-256). Cada token: uma loja, os escopos, quem
-- autorizou (o presidente da empresa), por onde (console da distribuição no piloto), o último
-- uso e a revogação. Emissão e revogação pelo console da distribuição; a própria integração
-- também revoga o dela (`POST /api/v1/integracao/autorizacao/revogar`).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. A tabela nunca existe lá (não entra no
--    sincronismo nem nas listas do sync-daemon) e o módulo que a usa não sobe no servidor da loja.
-- ⚠️ Aplicar na NUVEM ANTES do merge (V9e): o console lista a tabela e a API a lê a cada chamada.
-- ⚠️ Nome NOVO de propósito: a `integracao_token` que estava declarada no schema (sem migration no
--    git; pode existir na nuvem com as colunas velhas) NÃO é reaproveitada — um
--    `create table if not exists` com o mesmo nome passaria calado.
-- Idempotente. Cria chaves estrangeiras para `empresa` e `unidade` (poucas escritas): o
-- `lock_timeout` faz a migration desistir em vez de enfileirar escrita atrás dela.
set local lock_timeout = '5s';

create table if not exists integracao_token_loja (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references empresa(id) on delete cascade,
  unidade_id          uuid not null references unidade(id),
  cliente             text not null,                 -- 'liame' (a C1b troca por referência ao cliente cadastrado)
  prefixo             text not null,                 -- 'rgm_it_' + 5 caracteres, para reconhecer na tela
  token_hash          text not null unique,          -- sha256 (hex) do token inteiro; o token em si nunca é gravado
  escopos             text[] not null,
  autorizado_por      uuid not null,                 -- colaborador (presidente) que autorizou
  autorizado_por_nome text not null,
  autorizado_via      text not null,                 -- 'console_distribuicao' | 'autorizacao_loja'
  emitido_por_dist    uuid,                          -- usuário da distribuição que emitiu (piloto)
  evidencia           text,                          -- ex.: "autorização por escrito em 29/09/2026"
  criado_em           timestamptz not null default now(),
  expira_em           timestamptz,                   -- nulo = vale até revogar (decisão do dono)
  ultimo_uso_em       timestamptz,
  ultimo_ip           text,
  revogado_em         timestamptz,
  revogado_por        text,
  motivo_revogacao    text,
  constraint ck_integracao_token_loja_escopos check (
    cardinality(escopos) > 0
    and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                         'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                         'cupons.criar']::text[]
  ),
  constraint ck_integracao_token_loja_via check (
    autorizado_via in ('console_distribuicao', 'autorizacao_loja')
  ),
  constraint ck_integracao_token_loja_prefixo check (left(prefixo, 7) = 'rgm_it_')
);

-- Tokens ativos de uma empresa (console e, na C1c, "a empresa está conectada?").
create index if not exists idx_integracao_token_loja_ativo
  on integracao_token_loja (tenant_id) where revogado_em is null;

-- Hash do token, quem autorizou e o último IP: fora do alcance da API REST anônima do Supabase.
-- RLS ligada e SEM política, como as tabelas da mig 191; o app usa um papel que atravessa a RLS
-- (a última linha da conferência confere). Ativar a RLS por tenant exige política própria aqui
-- (docs/rls-multitenant.md, pré-requisitos): o guard procura o token antes de saber a empresa.
alter table integracao_token_loja enable row level security;

-- Conferência no MESMO Run: as cinco linhas têm de vir com `ok = true`.
select 'tabela integracao_token_loja' as objeto,
       to_regclass(current_schema() || '.integracao_token_loja') is not null as ok
union all
select 'índice único do token_hash',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'integracao_token_loja'
                  and indexdef ilike '%unique%(token_hash)%')
union all
select 'índice dos tokens ativos',
       to_regclass(current_schema() || '.idx_integracao_token_loja_ativo') is not null
union all
select 'RLS ligada',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.integracao_token_loja')), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
