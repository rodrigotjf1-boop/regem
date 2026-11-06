-- @cloud-only
-- 372 — O ESTORNO DO PIX no cancelamento (06/11/2026). O dono cancelou um pedido do cardápio pago por Pix (Mercado Pago) e
-- o dinheiro não voltou: o cancelamento só estornava o SINAL de encomenda (`reembolsarSinal`); o pedido comum pago online
-- era cancelado sem pedido de estorno nenhum.
--
-- pedido_estorno — UMA linha por pedido cancelado que foi pago online (Pix pelo Mercado Pago, PagBank ou Rede). A rotina
--   da nuvem (`estorno-pix.service.ts`) cria a linha (`pendente`) para o cancelado pago e pede o estorno TOTAL ao gateway;
--   `feito` guarda o id do estorno; na 3ª falha fica `falhou` e um caso URGENTE entra na fila do Atendimento (devolver à
--   mão). Vale para TODO caminho de cancelamento (tela, servidor da loja pelo sincronismo, robô, cliente): a rotina olha o
--   pedido cancelado, não quem cancelou. Encomenda com sinal fica fora (o sinal tem o caminho dele).
--   `pedido_id` único: o mesmo pedido nunca ganha dois estornos (e o Mercado Pago ainda tem a chave de idempotência).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon; o índice em
-- pedido_externo também é só da nuvem — a rotina só roda lá). Idempotente; nada que apague objeto (LIC-171).
-- RLS ligada e SEM política (como a 342/356/366/370): fora do alcance da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists pedido_estorno (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references empresa(id) on delete cascade,
  pedido_id    uuid not null references pedido_externo(id) on delete cascade,
  provedor     text not null,                       -- mercadopago | pagseguro | rede
  valor        numeric(12, 2) not null,             -- o total do pedido (o estorno é TOTAL)
  situacao     text not null default 'pendente',    -- pendente | processando | feito | falhou
  tentativas   integer not null default 0,
  erro         text,                                -- o motivo da última falha (sem segredo)
  estorno_id   text,                                -- o id do estorno no gateway
  criado_em    timestamptz not null default clock_timestamp(),
  atualizado_em timestamptz not null default clock_timestamp(),
  feito_em     timestamptz,
  constraint ck_pedido_estorno_situacao check (situacao in ('pendente', 'processando', 'feito', 'falhou'))
);
create unique index if not exists uq_pedido_estorno_pedido on pedido_estorno (pedido_id);
create index if not exists idx_pedido_estorno_fila on pedido_estorno (atualizado_em) where situacao in ('pendente', 'processando');
alter table pedido_estorno enable row level security;

-- Os candidatos da rotina (cancelados pagos online), sem varrer todos os pedidos a cada volta.
create index if not exists idx_pedido_externo_cancelado_pago on pedido_externo (cancelado_em)
  where status = 'cancelado' and pago and status_pagamento = 'aprovado' and gateway_payment_id is not null;

-- Conferência (no mesmo Run): a tabela (com RLS) e os índices.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity as rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname = 'pedido_estorno'
union all
select 'indice', i.indexname, null
  from pg_indexes i
 where i.schemaname = current_schema() and i.indexname in ('uq_pedido_estorno_pedido', 'idx_pedido_estorno_fila', 'idx_pedido_externo_cancelado_pago')
 order by 1, 2;
