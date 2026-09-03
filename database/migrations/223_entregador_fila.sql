-- 223 — Fila de entregadores (Frente 2) + reserva de pedido (batch antes de iniciar a entrega).
-- Fila POR UNIDADE: só o 1º "aguardando" pode puxar/scanear pedido. Ao "Iniciar entrega(s)" vira
-- 'em_entrega' (sai da vez); ao concluir todas, re-entra na fila. Cloud-only na prática (o app
-- fala com a nuvem); as tabelas podem existir no edge inertes (endpoints do entregador @CloudOnly).

create table if not exists entregador_fila (
  colaborador_id uuid primary key,
  tenant_id uuid not null,
  unidade_id uuid,
  status text not null default 'aguardando', -- aguardando | em_entrega
  entrou_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_entregador_fila_ordem
  on entregador_fila (tenant_id, unidade_id, status, entrou_em);

-- Reserva de pedido (batch): o entregador "pega" pedidos prontos (entregador_id + reservado_em,
-- status ainda 'pronto') antes de "Iniciar entrega(s)" — que aí despacha + roteiriza + avisa o 1º.
alter table pedido_externo add column if not exists reservado_em timestamptz;
create index if not exists idx_pedido_reservado
  on pedido_externo (tenant_id, entregador_id, status) where reservado_em is not null;
