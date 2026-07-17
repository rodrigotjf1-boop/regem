-- Opção reutilizável do catálogo (Fase 2). Uma opção pode ser:
--   tipo='simples'  → produto simples (opcional liga a um produto existente)
--   tipo='ficha'    → preparado na loja com ficha técnica (baixa por ficha)
--   tipo='insumo'   → insumo comprado pronto (baixa por item de estoque)
-- Campos: nome, código PDV, preço de custo, descrição, imagem, controle de estoque,
-- e estados visível(ativo)/esgotado. Reutilizável entre complementos (ligação na Fase 3).
create table if not exists opcao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  codigo_pdv text,
  descricao text,
  imagem_ref text,
  tipo text not null default 'simples', -- simples | ficha | insumo
  preco_custo numeric not null default 0,
  controla_estoque boolean not null default false,
  ficha_id uuid,        -- tipo=ficha
  item_id uuid,         -- tipo=insumo (item_estoque)
  produto_ref_id uuid,  -- tipo=simples (opcional: liga a um produto existente)
  ativo boolean not null default true,     -- invisível no catálogo = false
  esgotado boolean not null default false, -- pausa/esgotado
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists opcao_tenant_idx on opcao(tenant_id);
