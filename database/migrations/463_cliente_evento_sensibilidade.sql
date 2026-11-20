-- @cloud-only
-- 463 · O QUE MOVE O CLIENTE (F3 parte 2 do `docs/plano-perfil-cliente.md`, §4.7 e §7.2; protótipo, a camada "O que move a
-- cliente" da ficha). Só NUVEM, como o resto do perfil (SO_NUVEM no sync-daemon).
--
-- cliente_evento_sensibilidade — por cliente DIRETO e tipo de evento (feriado, data comemorativa, dinheiro no bolso, evento
--   da loja): os pedidos dele em dia desse tipo contra o que se esperaria pelo ritmo dele no mesmo dia da semana sem evento
--   (o "risco relativo"), ENCOLHIDO para o da loja (Gama-Poisson), a chance de o efeito ser real (P(RR > 1)) e o selo — só
--   com ≥ 3 dias de evento com pedido, P ≥ 0,9 e o controle de falsos positivos no lote (Benjamini-Hochberg). Só se calcula
--   para o tipo que mexe na LOJA (primeiro a loja). Recalculada pela rotina noturna do perfil, numa transação: grava e apaga
--   o que não vale mais. Tabela à parte porque o recálculo do perfil reescreve as camadas inteiras.
--
-- `calculado_em` pelo `clock_timestamp()` (V9, ERR-379). RLS ligada e SEM política, como a 459. Sem instrução destrutiva
-- (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists cliente_evento_sensibilidade (
  cliente_id       uuid not null references cliente(id) on delete cascade,
  tipo             text not null,
  tenant_id        uuid not null references empresa(id) on delete cascade,
  rr               numeric(6,2) not null,
  prob             numeric(4,3) not null,
  pedidos          integer not null,
  esperado         numeric(8,2) not null,
  dias_com_pedido  integer not null,
  selo             boolean not null default false,
  calculado_em     timestamptz not null default clock_timestamp(),
  primary key (cliente_id, tipo),
  constraint cliente_evento_sensibilidade_tipo_ck check (tipo in ('feriado', 'comemorativa', 'dinheiro', 'loja'))
);
create index if not exists ix_cliente_evento_sensibilidade_selo on cliente_evento_sensibilidade (tenant_id, tipo) where selo;
alter table cliente_evento_sensibilidade enable row level security;

-- Conferência (no mesmo Run).
select to_regclass(current_schema() || '.cliente_evento_sensibilidade') is not null as tabela,
       (select count(*) from pg_constraint where conname = 'cliente_evento_sensibilidade_tipo_ck') as regra;
