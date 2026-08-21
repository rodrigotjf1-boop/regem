-- @cloud-only
-- 196_cardapio_evento.sql — Funil de visita do cardápio (F4). Eventos ANÔNIMOS
-- (sessão gerada no navegador do cliente; SEM PII) para medir conversão
-- visita → carrinho → checkout → pedido. Só na nuvem; escopo por tenant.
-- Alto volume → recomendável expurgo (evento > 90 dias). Idempotente.

create table if not exists cardapio_evento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  token text not null,
  sessao text not null,
  tipo text not null,        -- view_menu | add_carrinho | checkout | pagamento | pedido
  meta jsonb,
  criado_em timestamptz not null default now()
);

create index if not exists idx_cardapio_evento_funil on cardapio_evento (tenant_id, criado_em);
create index if not exists idx_cardapio_evento_sessao on cardapio_evento (token, sessao);
