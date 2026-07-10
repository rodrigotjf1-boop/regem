-- 075_cliente_endereco_bairro.sql — O endereço salvo do cliente referencia o
-- bairro da ÁREA DE ATENDIMENTO (cardapio_bairro), para já trazer o frete no
-- checkout. Idempotente.

alter table cliente_endereco add column if not exists bairro_id uuid;
