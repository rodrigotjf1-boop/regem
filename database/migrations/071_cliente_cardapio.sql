-- 071_cliente_cardapio.sql — Cliente do cardápio (link mágico assinado): perfil,
-- endereços salvos e histórico. Identidade por telefone; o vínculo com o pedido
-- alimenta "pedir de novo". LGPD: consentimento + poder esquecer os dados.
-- Idempotente. Rodar no Supabase (apply-sql.mjs) e no local (apply-all-local.mjs).

create table if not exists cliente (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text,
  telefone text not null,
  consentimento_lgpd boolean not null default false,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  unique (tenant_id, telefone)
);
create index if not exists idx_cliente_tenant on cliente (tenant_id);

create table if not exists cliente_endereco (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  cliente_id uuid not null references cliente(id) on delete cascade,
  apelido text,                 -- "Casa", "Trabalho"
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  referencia text,
  principal boolean not null default false,
  criado_em timestamptz not null default now()
);
create index if not exists idx_cliente_endereco_cliente on cliente_endereco (cliente_id);

-- Vínculo do pedido ao cliente (histórico / "pedir de novo").
alter table pedido_externo add column if not exists cliente_id uuid references cliente(id);
create index if not exists idx_pedido_externo_cliente on pedido_externo (cliente_id);
