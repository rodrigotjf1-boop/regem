-- @cloud-only
-- 333_integracao_limite.sql — O LIMITE DE CHAMADAS da API de integração no banco (Hub DMS, F3-8).
--
-- O limite (60 chamadas por minuto por acesso) morava na memória de cada processo da API: com duas cópias do serviço,
-- cada uma contava a sua (passava o dobro), e um deploy zerava a contagem. Agora a contagem fica nesta tabela, feita
-- NA MESMA instrução que valida o acesso (sem ida a mais ao banco). As duas vias (o `rgm_it_` e a ligação do DMS ID)
-- somam na mesma linha: a chave é o id do acesso. Sem a tabela, a API volta a contar na memória, com aviso no log —
-- nunca recusa uma chamada por causa do limite.
--
-- UNLOGGED: a contagem não precisa de WAL nem de cópia (um reinício do banco só zera a janela de 1 minuto em curso).
-- A janela começa na primeira chamada dela (como a da memória), não no relógio. Linha de acesso parado há mais de um
-- dia sai pela própria API (uma vez por hora).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a API de integração não sobe lá).
-- ⚠️ Aplicar na NUVEM ANTES do merge. Idempotente. Tabela nova e vazia, sem chave estrangeira.
set local lock_timeout = '5s';

create unlogged table if not exists integracao_limite (
  chave    text primary key,        -- o id do acesso (`integracao_token_loja.id`): as duas vias somam aqui
  inicio   timestamptz not null,    -- o começo da janela de 1 minuto (a primeira chamada dela)
  chamadas integer not null,        -- quantas chamadas na janela
  constraint ck_integracao_limite_chamadas check (chamadas > 0)
);

-- A chave e a contagem: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como a 295 (o app
-- usa um papel que atravessa a RLS).
alter table integracao_limite enable row level security;

-- Conferência no MESMO Run: as seis linhas têm de vir com `ok = true`. (Papel que não existe neste banco — o de teste —
-- conta como certo.)
select 'tabela integracao_limite' as objeto,
       to_regclass(current_schema() || '.integracao_limite') is not null as ok
union all
select 'sem WAL (unlogged)',
       coalesce((select c.relpersistence = 'u' from pg_class c
                  where c.oid = to_regclass(current_schema() || '.integracao_limite')), false)
union all
select 'RLS ligada',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.integracao_limite')), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true)
union all
select 'o papel do app conta e limpa (insert, update e delete)',
       coalesce((select has_table_privilege(r.rolname, to_regclass(current_schema() || '.integracao_limite'), 'insert')
                    and has_table_privilege(r.rolname, to_regclass(current_schema() || '.integracao_limite'), 'update')
                    and has_table_privilege(r.rolname, to_regclass(current_schema() || '.integracao_limite'), 'delete')
                   from pg_roles r where r.rolname = 'regem_app'), true)
union all
select 'a API REST anônima do Supabase não lê',
       coalesce((select not has_table_privilege(r.rolname, to_regclass(current_schema() || '.integracao_limite'), 'select')
                   from pg_roles r where r.rolname = 'anon'), true);
