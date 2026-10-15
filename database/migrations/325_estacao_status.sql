-- 325 — Estação de impressão: o último sinal de cada estação (fase 1 da central de impressão, PR 3).
--
-- A estação (o serviço do PC que imprime as impressoras ligadas nele — mig 324) bate a cada minuto
-- no servidor da loja (ou na nuvem, na loja sem servidor): versão, nome do PC, as impressoras que o
-- Windows dele tem. É o que deixa o painel dizer "Estação Delivery fora há 3 min" e mostrar, no
-- "Ligada em", as impressoras que existem naquele PC.
--
-- Estado de OPERAÇÃO desta máquina, uma linha por estação, atualizada a cada batida: NÃO sincroniza
-- (gravar no `equipamento`, que sincroniza nos dois sentidos, faria a linha ir e voltar a cada
-- minuto — o vaivém do ERR-235). O servidor da loja leva o resumo na saúde que já manda à nuvem.
-- No sync-daemon ela é DESCARTÁVEL (apagar não perde informação de negócio).
--
-- NÃO é @cloud-only: existe nos dois bancos. Idempotente.
set local lock_timeout = '5s';

create table if not exists estacao_status (
  equipamento_id uuid primary key,
  tenant_id uuid not null,
  unidade_id uuid,
  versao text,
  maquina text,
  impressoras jsonb not null default '[]',
  visto_em timestamptz not null default now()
);

create index if not exists idx_estacao_status_tenant on estacao_status (tenant_id);

-- Só o app lê: sem política, a API do Supabase (anon/authenticated) não enxerga nada.
alter table estacao_status enable row level security;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'tabela estacao_status' as objeto,
       exists (select 1 from information_schema.tables
                where table_schema = current_schema() and table_name = 'estacao_status') as ok
union all
select 'índice idx_estacao_status_tenant',
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = current_schema() and c.relname = 'idx_estacao_status_tenant' and c.relkind = 'i')
union all
select 'RLS ligado em estacao_status',
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = current_schema() and c.relname = 'estacao_status'), false);
