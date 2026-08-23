-- @cloud-only
-- 210_entregador_saida_rastreio.sql — Entregas MULTI-PARADA + rastreio (cloud-only).
-- O módulo entregador é @CloudOnly (roda só na nuvem), então isto NÃO vai pro edge; o
-- sync ignora as colunas novas no pedido_externo (upsert filtra por colunas existentes).
--
-- Saída (roteiro): lote de pedidos atribuído a UM entregador numa viagem, com paradas
-- em ordem otimizada. O sistema forma a saída automaticamente (N prontos + entregador
-- livre) e ordena por vizinho-mais-próximo a partir da loja.
-- Aditiva e idempotente.

-- Limite do lote por viagem (config rápida no Painel Delivery). Default 1 = sem multi-parada.
alter table entregador_config
  add column if not exists max_pedidos_entregador smallint not null default 1;

-- Saída / roteiro.
create table if not exists entregador_saida (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null,
  colaborador_id uuid not null,
  status         text not null default 'em_rota',  -- montando | em_rota | concluida
  total_paradas  smallint not null default 0,
  criado_em      timestamptz not null default now(),
  concluida_em   timestamptz
);
create index if not exists ix_entregador_saida_tenant on entregador_saida (tenant_id, status);

-- Vínculo do pedido com a saída + ordem da parada + token público de rastreio.
-- rastreio_token nasce com a linha (default) — estável e sincroniza sem corrida (mesma
-- lição do despacho_token, mig 206). 16 hex = link público não-adivinhável do cliente.
alter table pedido_externo
  add column if not exists saida_id       uuid,
  add column if not exists ordem_parada   smallint,
  add column if not exists rastreio_token text;

alter table pedido_externo
  alter column rastreio_token
  set default substr(md5(random()::text || clock_timestamp()::text), 1, 16);

update pedido_externo
  set rastreio_token = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 16)
  where rastreio_token is null
    and tipo <> 'retirada'
    and status not in ('concluido', 'cancelado');

create index if not exists ix_pedido_saida on pedido_externo (tenant_id, saida_id, ordem_parada);
create index if not exists ix_pedido_rastreio on pedido_externo (rastreio_token);
