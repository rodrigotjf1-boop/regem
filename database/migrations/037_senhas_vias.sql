-- Fase F4 — Senha central + reset, etapas do KDS configuráveis, KDS de entrega,
-- observação por item, vias de impressão (cliente/produção).

-- ===== Senha sequencial central (por unidade), com reset =====
create table if not exists senha_contador (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  valor integer not null default 0,
  periodo text not null default 'diario', -- diario | semanal | nunca
  ultimo_reset date not null default current_date,
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_senha_tenant_unidade
  on senha_contador(tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid));

alter table comanda add column if not exists senha integer;
alter table producao_pedido add column if not exists senha integer;

-- ===== Etapas do KDS configuráveis por unidade (pronto é sempre obrigatória) =====
alter table kds_cor_config add column if not exists usa_preparo boolean not null default true;
alter table kds_cor_config add column if not exists usa_entregue boolean not null default true;

-- ===== Papel da impressora (via de produção x via do cliente) =====
alter table equipamento add column if not exists papel text; -- impressora: producao | cupom

-- ===== Observação por item =====
alter table comanda_item add column if not exists observacao text;
alter table producao_pedido_item add column if not exists observacao text;
