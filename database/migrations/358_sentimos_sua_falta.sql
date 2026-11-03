-- @cloud-only
-- 358 · "SENTIMOS SUA FALTA" (Onda 3 · PR 4; protótipo `mockups/regem-relacionamento.html`, aprovado pelo dono em
-- 03/11/2026). Só NUVEM: os ajustes da automática em `relacionamento_config` (a mesma rotina e o mesmo registro de envio da
-- 356; o cupom pessoal na `cupom_regra` da 357, origem 'volta').
--
--   volta_ativo             — nasce DESLIGADA.
--   volta_dias              — "Quem não pede há" 21/30/45/60 dias (padrão 30); até 30 dias depois disso (quem sumiu há
--                             mais tempo fica para as campanhas — o primeiro dia ligado não manda para a base inteira).
--   volta_min_pedidos       — "Só quem já pediu" 1/2/3 vezes ou mais (padrão 1).
--   volta_presente          — cupom de desconto (padrão) ou só a mensagem.
--   volta_desconto          — R$ 5 / R$ 8 (padrão) / R$ 10 / 10% / entrega grátis.
--   volta_minimo            — sem mínimo / R$ 30 (padrão) / R$ 40.
--   volta_validade_dias     — 3 / 7 (padrão) / 15.
--   volta_tentativas        — 1 / 2 (padrão), com 60 dias entre uma e outra; volta a valer depois que o cliente pede.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

alter table relacionamento_config add column if not exists volta_ativo boolean not null default false;
alter table relacionamento_config add column if not exists volta_dias integer not null default 30;
alter table relacionamento_config add column if not exists volta_min_pedidos integer not null default 1;
alter table relacionamento_config add column if not exists volta_presente text not null default 'cupom';
alter table relacionamento_config add column if not exists volta_desconto text not null default 'v8';
alter table relacionamento_config add column if not exists volta_minimo numeric(10, 2) not null default 30;
alter table relacionamento_config add column if not exists volta_validade_dias integer not null default 7;
alter table relacionamento_config add column if not exists volta_tentativas integer not null default 2;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_volta_dias check (volta_dias in (21, 30, 45, 60));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_volta_pedidos check (volta_min_pedidos in (1, 2, 3));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_volta_presente check (volta_presente in ('cupom', 'nada'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_volta_desconto check (volta_desconto in ('v5', 'v8', 'v10', 'p10', 'frete'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_volta_minimo check (volta_minimo in (0, 30, 40));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_volta_validade check (volta_validade_dias in (3, 7, 15));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_volta_tentativas check (volta_tentativas in (1, 2));
exception when duplicate_object then null; end $$;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'ajustes do "sentimos sua falta" (8 colunas)' as objeto,
       (select count(*) = 8 from information_schema.columns
         where table_schema = current_schema() and table_name = 'relacionamento_config' and column_name like 'volta_%') as ok
union all
select 'regras dos ajustes (7)',
       (select count(*) = 7 from pg_constraint
         where connamespace = to_regnamespace(current_schema()) and conname like 'ck_rel_config_volta_%');
