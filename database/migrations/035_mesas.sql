-- Fase F2 — Mesas como agrupador de comandas + comanda por cliente + dono (PDV).
-- Uma mesa pode ter 1 comanda (modo 'mesa') ou N comandas por cliente (modo 'comandas').
-- O "dono" é o colaborador/PDV que abriu a mesa — destino das notificações do garçom.

create table if not exists mesa (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  numero text not null,                 -- "12", "Varanda 3"…
  nome text,
  status text not null default 'aberta', -- aberta | fechada
  modo text not null default 'mesa',     -- mesa (1 comanda) | comandas (por cliente)
  dono_id uuid,                          -- colaborador/PDV que abriu (roteia o garçom)
  aberta_em timestamptz not null default now(),
  aberta_por_id uuid,
  fechada_em timestamptz,
  fechada_por_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists idx_mesa_tenant_status on mesa(tenant_id, status);
create index if not exists idx_mesa_dono on mesa(dono_id);

-- Comanda passa a poder pertencer a uma mesa e ter um identificador (cliente/pulseira/nº).
alter table comanda add column if not exists mesa_id uuid;
alter table comanda add column if not exists identificador text;
create index if not exists idx_comanda_mesa on comanda(mesa_id);
