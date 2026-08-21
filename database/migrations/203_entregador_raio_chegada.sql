-- @cloud-only
-- App do Entregador — raio (metros) do aviso automático de chegada, por loja.
-- Aditiva. Default 70m (o valor fixo que estava no código).
alter table entregador_config
  add column if not exists raio_chegada_m integer not null default 70;
