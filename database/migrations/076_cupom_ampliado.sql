-- 076_cupom_ampliado.sql — Cupons mais ricos + condicionais de uso.
-- Idempotente. Aplicar com backend/scripts/apply-sql.mjs (ou apply-all-local).
--
-- Novos recursos de cupom:
--   • tipo 'fretegratis' (zera a taxa de entrega) — além de 'percentual' | 'valor'
--   • teto_desconto: teto em R$ do desconto percentual (ex.: 10% até R$ 10,00)
-- Condicionais de uso (todos opcionais; null/false = sem condição):
--   • somente_novos: só clientes SEM pedido anterior no cardápio (cliente novo)
--   • max_por_cliente: nº máximo de usos por cliente (null = ilimitado)
--   • min_dias_sem_compra: cliente precisa estar há > N dias sem comprar
--     (cobre "30 dias sem compras", "60 dias sem compras", etc.)

alter table cupom add column if not exists teto_desconto numeric;
alter table cupom add column if not exists somente_novos boolean not null default false;
alter table cupom add column if not exists max_por_cliente integer;
alter table cupom add column if not exists min_dias_sem_compra integer;

-- Uso do cupom por cliente (para max_por_cliente e histórico).
create table if not exists cupom_uso (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  cupom_id uuid not null references cupom(id) on delete cascade,
  cliente_id uuid,
  telefone text,
  pedido_id uuid,
  usado_em timestamptz not null default now()
);
create index if not exists idx_cupom_uso_cupom_tel on cupom_uso (cupom_id, telefone);
create index if not exists idx_cupom_uso_tenant on cupom_uso (tenant_id);
