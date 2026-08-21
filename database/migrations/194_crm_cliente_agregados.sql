-- 194_crm_cliente_agregados.sql — CRM: base de clientes unificada (F2 do épico
-- painel/CRM). Agregados materializados no cliente (recência/frequência/valor) p/
-- segmentação rápida + opt-out de marketing (LGPD, uso interno do lojista).
-- Mantidos pelo ingest (TODOS os canais) e pelo backfill idempotente
-- (backend/scripts/backfill-clientes.mjs). Escopo sempre por tenant.
--
-- Idempotente. Rodar no Supabase (apply-sql.mjs) e no local (apply-all-local.mjs).
-- NÃO @cloud-only: `cliente` existe na nuvem E no edge (mig 071) — o .exe empacota.

alter table cliente
  add column if not exists primeiro_pedido_em timestamptz,
  add column if not exists ultimo_pedido_em   timestamptz,
  add column if not exists total_pedidos      integer       not null default 0,
  add column if not exists total_gasto        numeric(12,2) not null default 0,
  add column if not exists opt_out_marketing  boolean       not null default false;

-- Busca por telefone dentro do tenant (find-or-create + filtros de segmentação).
create index if not exists idx_cliente_tenant_telefone on cliente (tenant_id, telefone);
