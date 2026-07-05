-- Fase F1 — Produção durável (KDS/impressora) + roteamento por produto → N destinos
-- + tempos de preparo/cores. PDV é dono do ciclo; KDS informa e avança.

-- ===== Roteamento de produção =====
-- Destinos por produto (N:N) — cada destino é um equipamento (KDS ou impressora).
create table if not exists produto_destino_producao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  produto_id uuid not null references produto(id) on delete cascade,
  equipamento_id uuid not null references equipamento(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (produto_id, equipamento_id)
);
create index if not exists idx_pdp_produto on produto_destino_producao(produto_id);
create index if not exists idx_pdp_tenant on produto_destino_producao(tenant_id);

-- Padrão do setor — herdado quando o produto não define destino próprio.
create table if not exists setor_destino_producao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  setor_id uuid not null references setor(id) on delete cascade,
  equipamento_id uuid not null references equipamento(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (setor_id, equipamento_id)
);
create index if not exists idx_sdp_setor on setor_destino_producao(setor_id);
create index if not exists idx_sdp_tenant on setor_destino_producao(tenant_id);

-- ===== Pedido de produção (durável) — um por (comanda, destino) =====
create table if not exists producao_pedido (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  comanda_id uuid references comanda(id) on delete cascade,
  destino_equipamento_id uuid references equipamento(id) on delete set null,
  destino_tipo text not null default 'kds', -- kds | impressora
  setor_id uuid,
  numero integer,                            -- nº sequencial p/ exibição (por unidade/dia)
  origem text not null default 'balcao',     -- balcao | mesa | comanda | garcom
  mesa text,
  status text not null default 'recebido',   -- recebido | preparo | pronto | entregue | cancelado
  tempo_preparo_min integer,                 -- snapshot (maior tempo dos itens)
  criado_em timestamptz not null default now(),
  iniciado_em timestamptz,
  pronto_em timestamptz,
  entregue_em timestamptz,
  cancelado_em timestamptz,
  cancelado_por_id uuid,
  obs text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pp_destino on producao_pedido(destino_equipamento_id, status);
create index if not exists idx_pp_comanda on producao_pedido(comanda_id);
create index if not exists idx_pp_tenant_status on producao_pedido(tenant_id, status);
create index if not exists idx_pp_setor on producao_pedido(setor_id);

create table if not exists producao_pedido_item (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  pedido_id uuid not null references producao_pedido(id) on delete cascade,
  comanda_item_id uuid,
  descricao text not null,
  quantidade numeric not null default 1,
  complementos_texto text,
  status text not null default 'ok'          -- ok | alterado | removido
);
create index if not exists idx_ppi_pedido on producao_pedido_item(pedido_id);

-- ===== Produto: tempo de preparo (min) p/ cores do KDS =====
alter table produto add column if not exists tempo_preparo_min integer;

-- ===== Config de cores do KDS por unidade (limiares em minutos) =====
create table if not exists kds_cor_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  verde_ate_min integer not null default 5,   -- <= verde
  amarelo_ate_min integer not null default 10, -- <= amarelo; acima = vermelho
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_kds_cor_tenant_unidade
  on kds_cor_config(tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- ===== Equipamento: escopo (produção do setor | avisos) + setor =====
alter table equipamento add column if not exists escopo text not null default 'producao'; -- producao | avisos
alter table equipamento add column if not exists setor_id uuid;
