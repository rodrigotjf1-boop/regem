-- @cloud-only
-- 342 · ROBÔ DE ATENDIMENTO E ATENDENTE TRABALHANDO JUNTOS (Fase 1 do "robô mais expert", 29/10/2026).
-- Só NUVEM, como a 215 (whatsapp_mensagem): o robô de WhatsApp e a caixa de conversas só existem na nuvem — o servidor
-- da loja usa a caixa repassando para ela.
--
-- O que entra:
--   robo_pausa — o robô CALADO numa conversa porque um humano assumiu: uma linha por número de cliente (pela chave do
--     telefone, que casa o com/sem 55 e o com/sem nono dígito — ERR-134). `ate` é quando o robô volta sozinho (nulo =
--     só quando alguém retomar). `motivo`: 'manual' (botão Pausar), 'atendente' (respondeu pela caixa do Regem), 'app'
--     (respondeu pelo app do WhatsApp, coexistência) ou 'retomado' (alguém clicou Retomar — vale também contra o chamado
--     aberto). Antes ficava num vetor dentro de cardapio_config (robo_pausados), sem prazo e regravado inteiro a cada
--     pausa — e a linha da config sincroniza com a loja, que podia sobrescrever a pausa.
--   robo_config — o que a loja ajusta no robô e não é do cardápio. Por enquanto: `pausa_minutos`, por quanto tempo o
--     robô fica calado depois que o atendente assume ou que ele mesmo chama o atendente (0 = até alguém retomar).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabelas novas e vazias; a chave estrangeira
-- para `empresa` só olha a tabela (o `lock_timeout` desiste em vez de enfileirar escrita atrás dela).
set local lock_timeout = '5s';

create table if not exists robo_pausa (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  telefone        text not null,                       -- como chegou (só dígitos)
  telefone_chave  text not null,                       -- chaveTelefone(): a comparação entre as formas do número
  ate             timestamptz,                         -- o robô volta sozinho; nulo = só quando alguém retomar
  motivo          text not null,
  por             uuid,                                -- colaborador que pausou/respondeu/retomou (nulo = automático)
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  constraint ck_robo_pausa_motivo check (motivo in ('manual', 'atendente', 'app', 'retomado'))
);

create unique index if not exists uq_robo_pausa_tenant_chave on robo_pausa (tenant_id, telefone_chave);

create table if not exists robo_config (
  tenant_id       uuid primary key references empresa(id) on delete cascade,
  pausa_minutos   integer not null default 60,
  atualizado_em   timestamptz not null default now(),
  atualizado_por  uuid,
  constraint ck_robo_config_pausa check (pausa_minutos between 0 and 1440)
);

-- Telefone do cliente: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como a 295 e a 303
-- (o app usa um papel que atravessa a RLS).
alter table robo_pausa enable row level security;
alter table robo_config enable row level security;

-- Conferência no MESMO Run: as oito linhas têm de vir com `ok = true`.
select 'tabela robo_pausa' as objeto,
       to_regclass(current_schema() || '.robo_pausa') is not null as ok
union all
select 'índice único (empresa, chave do telefone)',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'robo_pausa'
                  and indexname = 'uq_robo_pausa_tenant_chave' and indexdef ilike '%unique%')
union all
select 'tabela robo_config',
       to_regclass(current_schema() || '.robo_config') is not null
union all
select 'RLS ligada em robo_pausa',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.robo_pausa')), false)
union all
select 'RLS ligada em robo_config',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.robo_config')), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true)
-- Tabela nova sem permissão para o papel do app dá 500 "permission denied" (225–227, set/2026): conferir aqui.
union all
select 'regem_app lê e grava robo_pausa',
       case when not exists (select 1 from pg_roles where rolname = 'regem_app') then true
            else has_table_privilege('regem_app', current_schema() || '.robo_pausa', 'select, insert, update, delete') end
union all
select 'regem_app lê e grava robo_config',
       case when not exists (select 1 from pg_roles where rolname = 'regem_app') then true
            else has_table_privilege('regem_app', current_schema() || '.robo_config', 'select, insert, update') end;
