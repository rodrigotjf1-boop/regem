-- @cloud-only
-- 453 · A NOTA DO PEDIDO PELO CLIENTE (fase A1 do protótipo `mockups/regem-avaliacao-pedido.html`, aprovado em 18/11/2026
-- com a correção do dono: o link do Google só na nota 5). Só NUVEM, como a 365 ("Pedir avaliação no Google"): a página do
-- pedido (`/r/…`) e o robô só existem lá; a loja não tem a tabela nova (SO_NUVEM no sync-daemon) — Delivery › Avaliações,
-- no servidor da loja, pede à nuvem.
--
-- O que entra:
--   pedido_avaliacao — UMA nota por pedido (o índice único; a segunda tentativa não grava): a nota de 1 a 5, o que mais
--     pesou (até 6 das opções da tela), o comentário (até 300 letras), por onde veio ("pagina" agora; "whatsapp" na fase
--     A2, o formulário do WhatsApp oficial) e o caso do Atendimento que a nota baixa abriu (ou somou). `criado_em` pelo
--     `clock_timestamp()`: a lista é lida em ordem de tempo (V9, ERR-379).
--   robo_config.nota_* — os ajustes da loja (NASCE DESLIGADO): ligar; até qual nota abre caso no Atendimento (1, 2 ou 3 —
--     o padrão é 2); o prazo para avaliar depois da entrega (2, 7 ou 30 dias — o padrão é 7). A regra mora no serviço
--     (`avaliacao-pedido/nota-do-pedido.ts`): os CHECK daqui só guardam o que nunca pode entrar.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. A ORDEM importa (ERR-362): primeiro a tabela
-- nova (a chave estrangeira trava `empresa` sem segurar mais nada) e, por ÚLTIMO, os `alter` de `robo_config`. `add column`
-- com valor padrão constante não reescreve a tabela; o `lock_timeout` desiste em vez de enfileirar escrita atrás dela.
set local lock_timeout = '5s';

create table if not exists pedido_avaliacao (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  unidade_id  uuid,
  pedido_id   uuid not null,
  nota        smallint not null,
  pesou       text[] not null default '{}',
  comentario  text,
  origem      text not null,
  chamado_id  uuid,
  criado_em   timestamptz not null default clock_timestamp()
);
do $$ begin
  alter table pedido_avaliacao add constraint ck_pedido_avaliacao_nota check (nota between 1 and 5);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table pedido_avaliacao add constraint ck_pedido_avaliacao_origem check (origem in ('pagina', 'whatsapp'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table pedido_avaliacao add constraint ck_pedido_avaliacao_comentario check (comentario is null or char_length(comentario) <= 300);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table pedido_avaliacao add constraint ck_pedido_avaliacao_pesou check (cardinality(pesou) <= 6);
exception when duplicate_object then null; end $$;
-- UMA nota por pedido: a página e o WhatsApp gravam com `on conflict do nothing` (duas abas, duas réplicas — V24).
create unique index if not exists uq_pedido_avaliacao_pedido on pedido_avaliacao (pedido_id);
-- Delivery › Avaliações lê o período da empresa (hoje, 7 ou 30 dias), do mais novo para o mais antigo.
create index if not exists idx_pedido_avaliacao_periodo on pedido_avaliacao (tenant_id, criado_em desc);

-- Comentário e o pedido do cliente: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como a
-- 365 (o servidor usa um papel que atravessa a RLS).
alter table pedido_avaliacao enable row level security;

alter table robo_config add column if not exists nota_ativa boolean not null default false;
alter table robo_config add column if not exists nota_caso_ate smallint not null default 2;
alter table robo_config add column if not exists nota_prazo_dias smallint not null default 7;

-- Conferência (no mesmo Run).
select 'pedido_avaliacao' as objeto, exists (select 1 from information_schema.tables
  where table_schema = current_schema() and table_name = 'pedido_avaliacao') as ok
union all
select 'uq_pedido_avaliacao_pedido', exists (select 1 from pg_indexes
  where schemaname = current_schema() and indexname = 'uq_pedido_avaliacao_pedido')
union all
select 'ck_pedido_avaliacao (4 regras)', (select count(*) = 4 from pg_constraint
  where conrelid = to_regclass(current_schema() || '.pedido_avaliacao') and conname like 'ck\_pedido\_avaliacao\_%')
union all
select 'robo_config.nota_* (3 colunas)', (select count(*) = 3 from information_schema.columns
  where table_schema = current_schema() and table_name = 'robo_config' and column_name in ('nota_ativa', 'nota_caso_ate', 'nota_prazo_dias'));
