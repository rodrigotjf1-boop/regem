-- 079_endereco_geo.sql — Coordenadas no endereço do cliente (frete por raio).
-- Idempotente. O CEP já existe em cliente_endereco; a loja usa end_lat/end_lng.

alter table cliente_endereco add column if not exists lat numeric;
alter table cliente_endereco add column if not exists lng numeric;
