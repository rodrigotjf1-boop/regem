-- @cloud-only
-- 472 — MISTER: as regras de aviso de cada pessoa (versão 6, fase M6e; plano aprovado em 20/11/2026, `docs/plano-mister.md`
-- § "Versão 6" §4; protótipo `mockups/regem-mister-v6.html`, aba "Regras"). As 469–471 são de outras sessões (a fila do
-- robô, o Pulso e o Clube).
--
-- O reforço do dono (20/11): as instruções são dinâmicas — o Mister monta a regra com os dados que lê, pela instrução da
-- pessoa. A regra fica guardada na linguagem das seis partes (`mister-regra.ts`: fonte, filtros, medida, condição, quando
-- olhar e como avisar), conferida pelo código; um motor só a avalia a cada minuto.
--
-- mister_regra — uma regra de UMA pessoa numa empresa. Nasce `proposta` (vale 30 min, esperando o "Confirmar"), vira
--   `ativa` no toque; `pausada`, `apagada`, `descartada` (o "Mudar" ou a proposta vencida) e `concluida` (a de uma vez só,
--   que já olhou). `resumo` = o que o código escreveu e a pessoa confirmou; `estado` = o que o motor lembra entre as voltas
--   (os itens já avisados, se a condição valia, o dia em que olhou); `substitui` = os avisos da empresa que a pessoa deixa
--   de receber pelo WhatsApp enquanto a regra estiver ativa (nunca os críticos — a conferência é do código).
-- mister_regra_envio — cada aviso de uma regra, reservado pela chave ANTES de mandar (a mesma volta em duas réplicas, ou a
--   volta repetida, não manda duas vezes), com o texto (o toque em "Ver o que fazer" do modelo mostra) e o resultado.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (SO_NUVEM no sync-daemon). Idempotente; nada que apague objeto
-- (LIC-171). RLS ligada e SEM política: fora do alcance da API REST anônima.
set local lock_timeout = '5s';

create table if not exists mister_regra (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  colaborador_id     uuid not null references colaborador(id) on delete cascade,
  situacao           text not null default 'proposta',
  titulo             text not null,
  resumo             text not null,
  fonte              text not null,
  regra              jsonb not null,
  substitui          text[] not null default '{}',
  substitui_regra_id uuid,                                   -- a regra antiga que esta troca (mudar = propor a nova)
  estado             jsonb not null default '{}'::jsonb,
  vence_em           timestamptz,                            -- a proposta que ninguém confirmou some
  criada_em          timestamptz not null default clock_timestamp(),
  atualizada_em      timestamptz not null default clock_timestamp(),
  ativada_em         timestamptz,
  apagada_em         timestamptz,
  ultimo_envio_em    timestamptz,
  constraint ck_mister_regra_situacao check (situacao in ('proposta', 'ativa', 'pausada', 'apagada', 'descartada', 'concluida')),
  constraint ck_mister_regra_regra check (jsonb_typeof(regra) = 'object'),
  constraint ck_mister_regra_titulo check (char_length(titulo) between 1 and 80)
);
-- As regras de uma pessoa (a lista, o teto de 30) e as ativas (a volta do motor).
create index if not exists idx_mister_regra_pessoa on mister_regra (tenant_id, colaborador_id) where situacao in ('proposta', 'ativa', 'pausada');
create index if not exists idx_mister_regra_ativa on mister_regra (tenant_id) where situacao = 'ativa';
alter table mister_regra enable row level security;

create table if not exists mister_regra_envio (
  id             uuid primary key default gen_random_uuid(),
  regra_id       uuid not null references mister_regra(id) on delete cascade,
  tenant_id      uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null,
  chave          text not null,
  texto          text not null,
  resultado      text,
  criado_em      timestamptz not null default clock_timestamp(),
  constraint uq_mister_regra_envio unique (regra_id, chave)
);
create index if not exists idx_mister_regra_envio_criado on mister_regra_envio (criado_em);
alter table mister_regra_envio enable row level security;

comment on table mister_regra is 'Mister v6 (mig 472): as regras de aviso de cada pessoa, montadas com os dados que o Mister lê — só nuvem';
comment on table mister_regra_envio is 'Mister v6 (mig 472): cada aviso de uma regra, reservado pela chave antes de mandar — só nuvem';

-- Conferência (no mesmo Run): as duas tabelas (com RLS), as travas e os índices.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname in ('mister_regra', 'mister_regra_envio') and c.relkind = 'r'
union all
select 'trava', conname, null from pg_constraint where conname in ('ck_mister_regra_situacao', 'ck_mister_regra_regra', 'ck_mister_regra_titulo', 'uq_mister_regra_envio')
union all
select 'indice', indexname, null from pg_indexes where schemaname = current_schema()
   and indexname in ('idx_mister_regra_pessoa', 'idx_mister_regra_ativa', 'idx_mister_regra_envio_criado')
 order by 1, 2;
