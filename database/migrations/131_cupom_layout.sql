-- 131_cupom_layout.sql
-- Layout/formatação do cupom (via do cliente) por loja — usado nas impressoras
-- térmicas (menu Delivery → Configurações → Impressoras e cupons). Ajuda a
-- produção sem KDS (mais detalhes no cupom). Aditivo; default = comportamento atual.
alter table delivery_config
  add column if not exists cupom_layout jsonb not null default '{}'::jsonb;
