-- @cloud-only
-- 237_pedido_notificacao.sql — notificação IN-APP de mudança de status do pedido para o
-- cliente do cardápio. Usada quando o PRINCIPAL está na API oficial e o cliente NÃO iniciou
-- conversa no WhatsApp: o aviso vai para o histórico de pedidos dele no cardápio (+ botão de
-- rastreio), sem iniciarmos conversa. CLOUD-ONLY: o cliente acompanha o pedido na nuvem (o
-- edge não serve o cardápio do cliente). Idempotente.

create table if not exists pedido_notificacao (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null,
  pedido_externo_id uuid not null,
  cliente_id        uuid not null,
  evento            text not null,
  titulo            text not null,
  texto             text not null,
  rastreio_url      text,
  lida              boolean not null default false,
  criado_em         timestamptz not null default now()
);

-- Listagem por cliente (as não lidas primeiro, mais recentes no topo).
create index if not exists idx_pedido_notificacao_cliente
  on pedido_notificacao (tenant_id, cliente_id, criado_em desc);
