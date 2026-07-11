-- 081_evolution_instancia.sql — WhatsApp da loja (Evolution) por cardápio.
-- A instância do Evolution (nome derivado da loja) é a chave do bot multi-tenant
-- (o n8n resolve a loja pela instância). Idempotente.

alter table cardapio_config add column if not exists evolution_instancia text;
alter table cardapio_config add column if not exists evolution_numero text;

create unique index if not exists idx_cardapio_evolution_instancia
  on cardapio_config (evolution_instancia)
  where evolution_instancia is not null;
