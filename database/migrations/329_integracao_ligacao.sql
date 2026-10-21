-- @cloud-only
-- 329_integracao_ligacao.sql — A LIGAÇÃO do Hub DMS (F3, parte A): a credencial nova da API de integração.
--
-- Com a via do DMS ID ligada (`DMS_ID_LIGADO`), a integração chama com DUAS coisas: o token do DMS ID
-- (`Authorization: Bearer <jwt>`, que diz QUAL APLICATIVO chama) e o segredo da ligação (`DMS-Ligacao:
-- dms_lg_regem_…`, que diz QUAL AUTORIZAÇÃO vale). Vazar um só não abre nada. O `rgm_it_` segue valendo ao lado.
--
-- A ligação NÃO é uma autorização nova: é outra forma de apresentar a MESMA linha de `integracao_token_loja`
-- (o mesmo id, com chave estrangeira). A loja, os escopos, quem autorizou, a validade e a revogação continuam lá:
-- revogar o token (console, "Aplicativos conectados", autorização nova da loja, a própria integração) corta a
-- ligação na chamada seguinte, sem passo a mais. O limite por minuto, a idempotência dos cupons e o aviso seguem
-- a mesma chave pelas duas vias.
--
-- Nasce na troca automática (`POST /api/v1/integracao/dms-id/ligacao`): o aplicativo manda o token do DMS ID e o
-- `rgm_it_` que já usa naquela loja e recebe o segredo, que aparece só nessa resposta. Repetir a troca gira o
-- segredo (o anterior para de valer na hora). Ligação revogada sozinha não volta pela troca.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. A tabela nunca existe lá (não entra no sincronismo nem
--    nas listas do sync-daemon) e o módulo que a usa não sobe no servidor da loja.
-- ⚠️ DEPENDE da 295. Aplicar na NUVEM ANTES do merge (V9e): com a via ligada, o guard da API a lê a cada chamada.
-- Idempotente. Tabela nova e vazia; as chaves estrangeiras só olham `empresa` e `integracao_token_loja` (o
-- `lock_timeout` faz a migration desistir em vez de enfileirar escrita atrás delas).
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null then
    raise exception 'A 329 depende da 295 (integracao_token_loja): aplique-a antes.';
  end if;
end $$;

create table if not exists integracao_ligacao (
  id            uuid primary key references integracao_token_loja(id) on delete cascade, -- o MESMO id do token
  tenant_id     uuid not null references empresa(id) on delete cascade,
  aplicativo    text not null,                 -- o aplicativo dono da ligação no DMS ID (client_id); só a distribuição vê
  prefixo       text not null,                 -- 'dms_lg_regem_' + 5 caracteres, para reconhecer no registro
  segredo_hash  text not null unique,          -- sha256 (hex) do segredo inteiro; o segredo em si nunca é gravado
  criado_em     timestamptz not null default now(),
  segredo_em    timestamptz not null default now(), -- a última troca: repetir a troca gira o segredo
  ultimo_uso_em timestamptz,
  revogado_em   timestamptz,                   -- a ligação sozinha (o token continua): a troca não a traz de volta
  revogado_por  text,
  constraint ck_integracao_ligacao_hash check (segredo_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_integracao_ligacao_prefixo check (prefixo ~ '^dms_lg_regem_[A-Za-z0-9_-]{5}$'),
  constraint ck_integracao_ligacao_aplicativo check (aplicativo ~ '^[A-Za-z0-9_-]{4,64}$')
);

-- As ligações de uma empresa (console da distribuição; o registro do hub na parte A2).
create index if not exists idx_integracao_ligacao_tenant on integracao_ligacao (tenant_id);

-- Resumo do segredo e o aplicativo do DMS ID: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM
-- política, como a 295 (o app usa um papel que atravessa a RLS; o guard procura a ligação antes de saber a empresa).
alter table integracao_ligacao enable row level security;

-- Conferência no MESMO Run: as seis linhas têm de vir com `ok = true`.
select 'tabela integracao_ligacao' as objeto,
       to_regclass(current_schema() || '.integracao_ligacao') is not null as ok
union all
select 'índice único do segredo_hash',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'integracao_ligacao'
                  and indexdef ilike '%unique%(segredo_hash)%')
union all
select 'o id é o do token (chave estrangeira para integracao_token_loja)',
       exists (select 1 from pg_constraint c
                where c.conrelid = to_regclass(current_schema() || '.integracao_ligacao')
                  and c.contype = 'f'
                  and c.confrelid = to_regclass(current_schema() || '.integracao_token_loja'))
union all
select 'índice das ligações por empresa',
       to_regclass(current_schema() || '.idx_integracao_ligacao_tenant') is not null
union all
select 'RLS ligada',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.integracao_ligacao')), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
