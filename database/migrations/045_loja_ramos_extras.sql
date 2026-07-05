-- Fase L4/L5 — especializações por ramo + extras da Loja.

-- L4 Varejo: variação em grade (atributos, ex.: {tamanho, cor}).
alter table produto_variacao add column if not exists atributos jsonb not null default '{}';

-- L4 Varejo: parcelamento (exibição na loja).
alter table cardapio_config add column if not exists parcelas_max integer;

-- L4 Serviços: agendamento no pedido; L4 Indústria: CNPJ (faturamento).
alter table pedido_externo add column if not exists agendamento timestamptz;
alter table pedido_externo add column if not exists profissional text;
alter table pedido_externo add column if not exists cnpj text;

-- L5 combo por etapa: snapshot do produto vinculado da opção (para re-baixa).
alter table comanda_item_complemento add column if not exists produto_ref_id uuid;

-- L5 Fidelidade: saldo de pontos por cliente (telefone).
create table if not exists fidelidade_cliente (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  telefone text not null,
  nome text,
  pontos integer not null default 0,
  atualizado_em timestamptz not null default now()
);
create unique index if not exists uq_fidelidade_tenant_tel on fidelidade_cliente(tenant_id, telefone);
