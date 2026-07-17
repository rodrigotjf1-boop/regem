-- Complemento reutilizável (etapa) do catálogo — Fase 3. Distinto do motor
-- per-product `complemento_grupo`/`complemento_opcao` (que a Fase 4 vai materializar).
-- regra: uma | varias_sem_repeticao | varias_com_repeticao. canais = onde aparece.
create table if not exists complemento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  regra text not null default 'uma', -- uma | varias_sem_repeticao | varias_com_repeticao
  obrigatorio boolean not null default false,
  min integer not null default 0,
  max integer,
  canais jsonb not null default '["delivery","balcao","mesa_publico","mesa_interno"]',
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists complemento_tenant_idx on complemento(tenant_id);

-- Ligação N:N complemento ↔ opção (com preço e ordem por vínculo).
create table if not exists complemento_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  complemento_id uuid not null references complemento(id) on delete cascade,
  opcao_id uuid not null references opcao(id) on delete cascade,
  preco numeric not null default 0,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists complemento_item_comp_idx on complemento_item(complemento_id);
create index if not exists complemento_item_opcao_idx on complemento_item(opcao_id);
