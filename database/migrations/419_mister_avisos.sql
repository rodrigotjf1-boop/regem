-- @cloud-only
-- 419 — MISTER: os AVISOS (F1.2 do plano em `docs/plano-mister.md`; versão 2 do protótipo `mockups/regem-mister.html`,
-- aprovada pelo dono em 14/11/2026: "para onde vai" cada aviso).
--
-- Cada aviso vai para quem resolve: o que a equipe resolve aparece na tela da loja e no KDS; o que pede o gestor vai pelo
-- WhatsApp do Mister; o técnico vai ao suporte da DMS. O destino de cada TIPO é escolhido pela empresa (Mister › Avisos e
-- relatórios); sem escolha, vale o padrão aprovado em 14/11 (no código, `mister-avisos.regras.ts`).
--
-- mister_aviso_regra — a escolha da empresa para um tipo de aviso: ligado, os destinos, o tempo de "se ninguém resolver" e
--   para quem vai então, e o parâmetro do tipo (o tempo do pedido parado). Sem linha = o padrão.
--
-- mister_aviso — cada EPISÓDIO de aviso: abre quando a situação aparece, fecha quando some. A chave diz o alvo dentro do
--   tipo (o servidor e a impressora, o caixa, a empresa…); um episódio aberto por tipo e alvo (índice único parcial — a
--   volta repetida e a réplica a mais caem no `on conflict`). Guarda o texto que foi aos destinos e, em `entregas`, a
--   trilha de cada entrega (destino, quando, se saiu e o motivo quando não saiu) — nunca telefone inteiro.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as tabelas ficam em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como a 414, a 415, a 417 e a 418).
set local lock_timeout = '5s';

create table if not exists mister_aviso_regra (
  tenant_id          uuid not null references empresa(id) on delete cascade,
  tipo               text not null,                      -- impressora | pedido_parado | caixa_24h | … (mister-avisos.regras.ts)
  ligado             boolean not null,
  destinos           text[] not null default '{}',       -- presidente | gerente | tela | kds | atendimento | dms
  escala_min         integer,                            -- "se ninguém resolver" depois de N minutos (NULL = não escala)
  escala_para        text[] not null default '{}',
  parametro          integer,                            -- o tempo do pedido parado, em minutos (NULL nos outros tipos)
  alterado_por       uuid,
  atualizado_em      timestamptz not null default now(),
  primary key (tenant_id, tipo)
);
alter table mister_aviso_regra enable row level security;

create table if not exists mister_aviso (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  unidade_id         uuid,                               -- a loja do aviso (NULL = a empresa inteira)
  tipo               text not null,
  chave              text not null,                      -- o alvo dentro do tipo: srv:<id>:impressora:<x> · caixa:<id> · chave_ia
  situacao           text not null default 'aberto',     -- aberto | resolvido
  titulo             text not null,                      -- a frase curta ("Impressora da cozinha parada")
  detalhe            text,                               -- o que fazer
  dados              jsonb not null default '{}'::jsonb, -- os números do aviso (sem dado pessoal)
  aberto_em          timestamptz not null default clock_timestamp(),
  visto_em           timestamptz not null default clock_timestamp(),   -- a última volta que ainda viu a situação
  escalado_em        timestamptz,                        -- quando o "se ninguém resolver" saiu
  resolvido_em       timestamptz,
  entregas           jsonb not null default '[]'::jsonb, -- [{ destino, fase: abriu|escalou|resolveu, em, ok, motivo, final }]
  constraint ck_mister_aviso_situacao check (situacao in ('aberto', 'resolvido'))
);
create unique index if not exists uq_mister_aviso_aberto on mister_aviso (tenant_id, tipo, chave) where situacao = 'aberto';
create index if not exists ix_mister_aviso_empresa on mister_aviso (tenant_id, aberto_em desc);
create index if not exists ix_mister_aviso_abertos on mister_aviso (aberto_em) where situacao = 'aberto';
alter table mister_aviso enable row level security;

comment on table mister_aviso_regra is 'Mister (mig 419): para onde vai cada tipo de aviso, por empresa — só nuvem; sem linha = o padrão aprovado em 14/11/2026';
comment on table mister_aviso is 'Mister (mig 419): os episódios de aviso e a trilha das entregas — só nuvem';

-- Conferência (no mesmo Run): as duas tabelas (com RLS), as colunas, os índices e a restrição.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname in ('mister_aviso_regra', 'mister_aviso')
union all
select 'colunas', table_name, count(*)::text
  from information_schema.columns
 where table_schema = current_schema() and table_name in ('mister_aviso_regra', 'mister_aviso')
 group by table_name
union all
select 'indice', indexname, tablename
  from pg_indexes
 where schemaname = current_schema() and tablename in ('mister_aviso_regra', 'mister_aviso')
union all
select 'restricao', conname, contype::text
  from pg_constraint
 where conrelid = to_regclass('mister_aviso') and contype = 'c'
 order by 1, 2;
