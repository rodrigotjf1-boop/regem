-- 051 — Delivery: entregadores (função Entregador) + telefone, e marca de "alterado"

-- Contato do colaborador (usado para o telefone do entregador em rota).
alter table colaborador add column if not exists telefone text;

-- Pedido alterado (correção de itens): observação + reimpressão + "ALTERADO" no KDS.
alter table pedido_externo add column if not exists alterado boolean not null default false;
alter table pedido_externo add column if not exists alterado_em timestamptz;

-- Telefone do entregador no momento do despacho (snapshot, resiliente a edições).
alter table pedido_externo add column if not exists entregador_telefone text;
