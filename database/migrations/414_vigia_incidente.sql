-- @cloud-only
-- 414 — VIGIA: os incidentes do servidor da loja (F1.1 do plano do Mister, `docs/plano-mister.md`; pedido do dono de
-- 12/11/2026: começar pelos "olhos", sem IA). Hoje a nuvem recebe a saúde completa de cada servidor de loja a cada
-- minuto (`edge_status`: serviços, disco, backup, banco, relógio, sync, impressoras) e ninguém é avisado de nada: há só
-- selos nas telas, para quem abrir a tela. E a telemetria só avisa na PRIMEIRA vez que uma mensagem aparece — problema
-- que vai e volta (servidor fora hoje, de novo na semana que vem) não tem onde ficar.
--
-- vigia_incidente — UM incidente por EPISÓDIO: abriu (o vigia viu o problema), foi visto de novo (`vezes`, `ultima_em`),
--   fechou (`recuperado` = o problema sumiu; `encerrado` = o servidor saiu da vigia, desativado ou trocado). A rotina da
--   nuvem (`modules/vigia/vigia.service.ts`) lê `edge_status`, aplica as regras puras (`vigia.regras.ts`) e grava aqui.
--   `chave` = o alvo dentro da empresa (o servidor, o serviço dele, a impressora); UM incidente ABERTO por regra e chave
--   (índice único parcial, V24): a volta seguinte e uma segunda réplica caem no "já existe" e só somam `vezes`.
--   `publico` = de quem é o problema: a infraestrutura (serviço, disco, backup, banco) é da DISTRIBUIÇÃO; o que a loja
--   resolve (servidor sem sinal, impressora parada) é da loja. `evidencia` = os números observados, sem dado pessoal.
--   Nesta entrega NINGUÉM é avisado: a tabela só guarda os episódios. Os destinos (webhook da distribuição, caso no
--   Atendimento) são a entrega seguinte e dependem de decisão do dono.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon; a rotina só roda na
-- nuvem e nasce DESLIGADA — variável VIGIA_LIGADO). Idempotente; nada que apague objeto (LIC-171).
-- RLS ligada e SEM política (como a 342/356/372): fora do alcance da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists vigia_incidente (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid,                                -- a loja do servidor (NULL = servidor sem loja marcada)
  equipamento_id uuid,                                -- o servidor da loja; sem FK: o equipamento pode sair e o episódio fica
  regra          text not null,                       -- servidor_sem_sinal | servico_parado | disco_baixo | backup_atrasado | …
  chave          text not null,                       -- o alvo dentro da empresa: srv:<id> | srv:<id>:servico:pg | srv:<id>:impressora:<id>
  gravidade      text not null,                       -- critico | atencao
  publico        text not null,                       -- distribuicao | loja | ambos
  situacao       text not null default 'aberto',      -- aberto | recuperado | encerrado
  evidencia      jsonb not null default '{}'::jsonb,  -- os números observados (sem dado pessoal)
  vezes          integer not null default 1,          -- em quantas voltas o problema foi visto neste episódio
  primeira_em    timestamptz not null default clock_timestamp(),
  ultima_em      timestamptz not null default clock_timestamp(),
  fechado_em     timestamptz,                         -- quando saiu de "aberto"
  constraint ck_vigia_incidente_gravidade check (gravidade in ('critico', 'atencao')),
  constraint ck_vigia_incidente_publico check (publico in ('distribuicao', 'loja', 'ambos')),
  constraint ck_vigia_incidente_situacao check (situacao in ('aberto', 'recuperado', 'encerrado'))
);
-- Um incidente ABERTO por empresa, regra e alvo: é o que impede o segundo episódio igual (duas voltas, duas réplicas).
create unique index if not exists uq_vigia_incidente_aberto on vigia_incidente (tenant_id, regra, chave) where situacao = 'aberto';
-- Os abertos de um servidor (a volta fecha por aqui) e a lista por empresa, do mais novo para o mais antigo.
create index if not exists idx_vigia_incidente_servidor on vigia_incidente (equipamento_id) where situacao = 'aberto';
create index if not exists idx_vigia_incidente_empresa on vigia_incidente (tenant_id, primeira_em desc);
alter table vigia_incidente enable row level security;

comment on table vigia_incidente is 'Vigia (mig 414): um incidente por episódio do servidor da loja — só nuvem; nesta entrega ninguém é avisado';

-- Conferência (no mesmo Run): a tabela (com RLS) e os índices.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname = 'vigia_incidente'
union all
select 'indice', i.indexname, null
  from pg_indexes i
 where i.schemaname = current_schema() and i.indexname in ('uq_vigia_incidente_aberto', 'idx_vigia_incidente_servidor', 'idx_vigia_incidente_empresa')
 order by 1, 2;
