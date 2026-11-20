-- @cloud-only
-- 461 · CALENDÁRIO DA LOJA (F2 do `docs/plano-perfil-cliente.md`, §5 e §7.2; protótipo `mockups/regem-perfil-cliente.html`,
-- aba "Calendário"). Só NUVEM, como o resto do perfil do cliente (SO_NUVEM no sync-daemon): o calendário é montado e
-- servido pela nuvem; a loja não tem as tabelas.
--
-- O que entra:
--   evento_loja — o que a LOJA cadastra em Delivery › Clientes › Calendário de eventos: show ou festa na cidade, promoção
--     da casa, feriado municipal, jogo do time da região, outro; com o dia, a hora (opcional) e se repete (toda semana,
--     todo ano). `unidade_id` nulo = todas as lojas da empresa (V4: a loja vê os dela e os sem loja). Excluir = marcar
--     `excluido_em` (o histórico fica para o cálculo do efeito na fase F3).
--   calendario_loja_dia — a cópia do calendário por loja e dia (a regra fixa + os eventos da loja + os feriados e eventos
--     de Escalas › Feriado / evento), gravada pela rotina noturna do perfil: é o que as próximas fases cruzam com os
--     pedidos (F3, F7) e o que segue valendo se o produto de eventos do Hub DMS cair. Uma linha por loja e dia (também
--     os dias sem evento, com `[]`), pela chave (unidade_id, dia) — idempotente (V42).
--
-- `criado_em` pelo `clock_timestamp()` (V9, ERR-379). RLS ligada e SEM política, como a 459 (o servidor usa um papel que
-- atravessa a RLS). Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists evento_loja (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid references unidade(id) on delete cascade,
  nome           text not null,
  tipo           text not null,
  dia            date not null,
  hora           time,
  repete         text not null default 'nao',
  criado_por     uuid,
  criado_em      timestamptz not null default clock_timestamp(),
  atualizado_em  timestamptz not null default clock_timestamp(),
  excluido_em    timestamptz,
  constraint evento_loja_nome_ck check (char_length(btrim(nome)) between 2 and 80),
  constraint evento_loja_tipo_ck check (tipo in ('show', 'promocao', 'feriado_municipal', 'jogo_time', 'outro')),
  constraint evento_loja_repete_ck check (repete in ('nao', 'semana', 'ano'))
);
create index if not exists ix_evento_loja_tenant on evento_loja (tenant_id, dia) where excluido_em is null;
alter table evento_loja enable row level security;

create table if not exists calendario_loja_dia (
  unidade_id    uuid not null references unidade(id) on delete cascade,
  dia           date not null,
  tenant_id     uuid not null references empresa(id) on delete cascade,
  eventos       jsonb not null default '[]'::jsonb,
  calculado_em  timestamptz not null default clock_timestamp(),
  primary key (unidade_id, dia)
);
create index if not exists ix_calendario_loja_dia_tenant on calendario_loja_dia (tenant_id, dia);
alter table calendario_loja_dia enable row level security;

-- Conferência (no mesmo Run, na nuvem): as duas tabelas e as três regras do evento.
select
  (select count(*) from information_schema.tables where table_schema = current_schema()
     and table_name in ('evento_loja', 'calendario_loja_dia')) as tabelas,
  (select count(*) from pg_constraint where conname in ('evento_loja_nome_ck', 'evento_loja_tipo_ck', 'evento_loja_repete_ck')) as regras;
