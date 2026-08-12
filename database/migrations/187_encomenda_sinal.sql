-- 187_encomenda_sinal.sql
-- Sinal (entrada) + política de cancelamento da encomenda (S1). OPT-IN: só vale
-- com o modo Encomenda ligado. Regra BASE na config + regras por FAIXA de
-- quantidade (opcionais, várias) que sobrepõem a base quando a qtd de itens bate.

-- Regra base: toda encomenda exige sinal? qual %? e o prazo de cancelamento com
-- reembolso (horas antes do horário agendado).
alter table cardapio_config
  add column if not exists encomenda_exige_sinal boolean not null default false;
alter table cardapio_config
  add column if not exists encomenda_sinal_pct numeric;      -- % do sinal (base)
alter table cardapio_config
  add column if not exists encomenda_cancel_horas integer;   -- horas p/ cancelar com reembolso (base)

-- Faixas por quantidade de itens do pedido (ex.: 10–20 → sinal 50%, cancela 48h).
-- Vale a faixa cujo [min_itens, max_itens] contém a quantidade; senão, a base.
create table if not exists encomenda_regra_sinal (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  min_itens integer not null default 1,
  max_itens integer,                         -- null = sem teto
  exige_sinal boolean not null default true,
  sinal_pct numeric not null default 50,
  cancel_horas integer,                      -- prazo de cancelamento com reembolso (horas)
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_encomenda_regra_sinal_tenant
  on encomenda_regra_sinal (tenant_id);
