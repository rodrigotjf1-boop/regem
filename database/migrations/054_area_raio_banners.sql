-- 054 — Área de atendimento por raio (ou bairro) + banners do cardápio digital

-- Modo da área de atendimento: 'bairro' ou 'raio' (exclusivos).
alter table cardapio_config add column if not exists area_modo text not null default 'bairro';
-- Faixas de raio (a partir do endereço da loja): [{ate_km, taxa}] em ordem crescente.
alter table cardapio_config add column if not exists raios jsonb not null default '[]';
-- Coordenadas da loja (para o cálculo por raio quando houver geocoding).
alter table cardapio_config add column if not exists end_lat numeric;
alter table cardapio_config add column if not exists end_lng numeric;

-- Banners rotativos do cardápio digital.
create table if not exists banner (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  imagem_ref text not null,
  titulo text,
  link text,
  ordem integer not null default 0,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists idx_banner_tenant on banner(tenant_id);
