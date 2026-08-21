-- Base de clientes ciente de canal. Marketplace de número mascarado (iFood) NÃO
-- pode usar o telefone-proxy como identidade — vira índice por (origem, origem_id)
-- e telefone fica nulo (naturalmente fora das campanhas de WhatsApp).
-- Aditiva. Tabela compartilhada (nuvem + edge) — NÃO é @cloud-only.
alter table cliente alter column telefone drop not null;
alter table cliente add column if not exists origem text;     -- null = base própria (telefone); ex.: 'ifood'
alter table cliente add column if not exists origem_id text;  -- id do cliente no canal de origem
create unique index if not exists uq_cliente_origem
  on cliente (tenant_id, origem, origem_id) where origem is not null;
