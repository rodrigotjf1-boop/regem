-- Cadastro de formas de pagamento (financeiro) + multi-pagamento por comanda.

create table if not exists forma_pagamento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  tipo text not null default 'outro', -- dinheiro | pix | credito | debito | vr | outro
  ativo boolean not null default true,
  ordem integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_forma_pagamento_tenant on forma_pagamento(tenant_id);

-- Pagamentos de uma comanda (dividir conta / mais de uma forma).
create table if not exists comanda_pagamento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  comanda_id uuid not null references comanda(id) on delete cascade,
  forma text not null,               -- rótulo/tipo da forma escolhida
  forma_pagamento_id uuid,           -- ref opcional ao cadastro
  valor numeric not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists idx_comanda_pagamento_comanda on comanda_pagamento(comanda_id);
