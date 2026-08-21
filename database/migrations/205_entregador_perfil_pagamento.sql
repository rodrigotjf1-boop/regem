-- @cloud-only
-- App do Entregador (E5) — perfil de pagamento POR entregador (colaborador).
-- Sobrepõe o padrão da loja (entregador_config). Ex.: um entregador só recebe
-- diária; outro só taxas (moto é da loja). Só nuvem. Aditiva.
create table if not exists entregador_perfil_pagamento (
  tenant_id             uuid not null,
  colaborador_id        uuid primary key,
  modelo                text not null default 'diaria_taxas',
  diaria_centavos       integer not null default 0,
  taxa_entrega_centavos integer not null default 0,
  taxa_fixa_centavos    integer not null default 0,
  atualizado_em         timestamptz not null default now()
);
create index if not exists ix_entregador_perfil_tenant
  on entregador_perfil_pagamento (tenant_id);
