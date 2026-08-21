-- @cloud-only
-- App do Entregador (E5) — modelo de pagamento por loja + fechamento por entregador/dia.
-- Só nuvem (o módulo entregador é @CloudOnly). Aditiva.

-- Modelo de pagamento (1 por tenant).
-- modelo: diaria_taxas | so_diaria | so_taxas | so_taxa_fixa | diaria_taxas_fixas
create table if not exists entregador_config (
  tenant_id             uuid primary key,
  modelo                text not null default 'diaria_taxas',
  diaria_centavos       integer not null default 0,
  taxa_entrega_centavos integer not null default 0,
  taxa_fixa_centavos    integer not null default 0,
  atualizado_em         timestamptz not null default now()
);

-- Fechamento de pagamento por entregador/dia (append-only; histórico do que foi pago).
create table if not exists entregador_fechamento (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null,
  colaborador_id  uuid not null,
  data_ref        text not null,            -- YYYY-MM-DD
  modelo          text not null,
  entregas        integer not null default 0,
  diaria_centavos integer not null default 0,
  taxas_centavos  integer not null default 0,
  total_centavos  integer not null default 0,
  criado_por      uuid,
  criado_em       timestamptz not null default now()
);

-- Um fechamento por entregador por dia (idempotente).
create unique index if not exists ux_entregador_fechamento_dia
  on entregador_fechamento (tenant_id, colaborador_id, data_ref);

create index if not exists ix_entregador_fechamento_tenant_data
  on entregador_fechamento (tenant_id, data_ref);
