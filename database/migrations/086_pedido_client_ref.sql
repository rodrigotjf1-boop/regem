-- Idempotência do pedido público do cardápio.
-- O cliente gera um client_ref (UUID) quando monta o carrinho e reenvia o MESMO
-- valor em qualquer retry. O índice único (parcial) garante 1 pedido por ref,
-- mesmo sob corrida de duas requisições simultâneas.
alter table pedido_externo add column if not exists client_ref text;

create unique index if not exists pedido_externo_tenant_client_ref_uidx
  on pedido_externo (tenant_id, client_ref)
  where client_ref is not null;
