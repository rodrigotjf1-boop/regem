-- @cloud-only
-- 395 — A pausa dos pedidos, F3: "já avisei este cliente nesta pausa" (protótipo `mockups/regem-pausa.html`, aprovado em
-- 10/11/2026). Só NUVEM: o atendente (WhatsApp nas duas vias, Instagram Direct e Messenger) recebe as mensagens na nuvem.
--
-- Com o cardápio digital pausado, a PRIMEIRA mensagem do cliente ao atendente é respondida pelo Regem com a mensagem
-- pronta da pausa (formatada, com o motivo e a hora de volta) — uma vez por cliente em cada pausa. Esta tabela conta as
-- mensagens de cada cliente na pausa: a 1ª recebe a mensagem pronta; a F4 usa a contagem para a resposta em áudio quando
-- o cliente insiste.
--
-- A PAUSA é a linha da `pausa_canal` (pausa_id) com o `pausado_em` dela: estender não muda o `pausado_em` (o cliente não é
-- avisado de novo); pausar de novo muda (é outra pausa). `chave` = quem escreve, como o robô recebe (`de`: o telefone no
-- WhatsApp, `ig:<igsid>` no Direct, `fb:<psid>` no Messenger). A contagem sobe por `insert … on conflict do update`
-- (duas mensagens juntas: 1 e 2, nunca duas "1"). Idempotente.

create table if not exists pausa_aviso_cliente (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  pausa_id uuid not null,
  pausado_em timestamptz not null,
  chave text not null,
  mensagens integer not null default 1,
  avisado_em timestamptz,          -- quando a mensagem pronta saiu
  falado_em timestamptz,           -- F4: quando a resposta em áudio foi pedida
  criado_em timestamptz not null default clock_timestamp(),
  atualizado_em timestamptz not null default clock_timestamp()
);

create unique index if not exists ux_pausa_aviso_cliente on pausa_aviso_cliente (pausa_id, pausado_em, chave);
create index if not exists idx_pausa_aviso_cliente_tenant on pausa_aviso_cliente (tenant_id, criado_em);

-- Só o app lê: sem política, a API do Supabase (anon/authenticated) não enxerga nada.
alter table pausa_aviso_cliente enable row level security;

-- ===== Conferência (no mesmo Run): as três linhas têm de vir com `ok = true` =====
select 'tabela pausa_aviso_cliente' as objeto,
       to_regclass(current_schema() || '.pausa_aviso_cliente') is not null as ok
union all
select 'índice único (pausa, quando, quem)',
       to_regclass(current_schema() || '.ux_pausa_aviso_cliente') is not null
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pausa_aviso_cliente');
