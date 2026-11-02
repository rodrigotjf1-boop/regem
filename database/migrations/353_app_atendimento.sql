-- @cloud-only
-- 353 · O APP "REGEM ATENDIMENTO" (Onda 2 do plano do atendimento, aprovada pelo dono em 02/11/2026; protótipo
-- `mockups/regem-central-atendimento.html`, vista do app). Só NUVEM: o app fala com a nuvem (decisão do dono, 02/11:
-- "nuvem agora, loja depois"); o robô e o WhatsApp também moram lá.
--
-- O que entra:
--   atendimento_presenca — "Disponível" ou "Ocupado: embalando" de quem atende pelo app (uma linha por pessoa). Ocupado,
--     o app só toca para o que tem prazo. O app avisa a cada minuto; sem linha, ou sem aviso há mais de 3 min, a pessoa
--     está fora do app (regra única no servidor: `atendimento/presenca.ts`). Não sincroniza (é da nuvem — SO_NUVEM no
--     sync-daemon). O celular do app é um `equipamento` do tipo 'atendimento' (sem coluna nova: o tipo é texto livre).
--   robo_config.avisar_gerente_min — "Avisar o gerente se ninguém pegar o caso em" 2, 3, 5 ou 10 min (padrão 3);
--     0 = não avisa. O aviso chega ao app de quem é gerente ou presidente.
--   robo_config.dizer_posicao — o robô diz ao cliente o lugar dele na fila (padrão ligado, como já fazia).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabelas pequenas; o `lock_timeout` desiste
-- em vez de enfileirar escrita atrás delas.
set local lock_timeout = '5s';

create table if not exists atendimento_presenca (
  colaborador_id uuid primary key references colaborador(id) on delete cascade,
  tenant_id      uuid not null references empresa(id) on delete cascade,
  estado         text not null default 'disponivel' check (estado in ('disponivel', 'ocupado')),
  motivo         text,
  desde          timestamptz not null default now(),
  equipamento_id uuid,
  atualizado_em  timestamptz not null default now()
);
create index if not exists idx_atendimento_presenca_tenant on atendimento_presenca (tenant_id);

-- Quem está atendendo agora e em que celular: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM
-- política, como a 342 e a 344 (o app usa um papel que atravessa a RLS).
alter table atendimento_presenca enable row level security;

alter table robo_config add column if not exists avisar_gerente_min integer not null default 3;
alter table robo_config add column if not exists dizer_posicao boolean not null default true;
do $$ begin
  alter table robo_config add constraint ck_robo_config_avisar_gerente_min check (avisar_gerente_min in (0, 2, 3, 5, 10));
exception when duplicate_object then null; end $$;

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`.
select 'tabela atendimento_presenca' as objeto,
       to_regclass(current_schema() || '.atendimento_presenca') is not null as ok
union all
select 'RLS ligada em atendimento_presenca',
       coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass(current_schema() || '.atendimento_presenca')), false)
union all
select 'robo_config.avisar_gerente_min e robo_config.dizer_posicao',
       (select count(*) = 2 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config'
           and column_name in ('avisar_gerente_min', 'dizer_posicao'))
union all
select 'regra 0/2/3/5/10 do aviso ao gerente',
       exists (select 1 from pg_constraint where conname = 'ck_robo_config_avisar_gerente_min');
