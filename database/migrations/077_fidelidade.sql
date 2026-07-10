-- 077_fidelidade.sql — Planos de fidelidade (L5). Idempotente.
--
-- Modelo:
--   fidelidade_plano   → definição do plano (regra + meta + prêmio + prazo)
--   fidelidade_cliente → saldo de pontos POR PLANO por cliente (telefone)
--   fidelidade_ponto   → 1 linha por pedido que pontuou num plano (dedupe: no
--                        máx. 1 ponto por pedido por plano)
--   fidelidade_resgate → prêmio conquistado (disponível/resgatado/expirado)
--
-- qualificador_tipo: 'qualquer' | 'categoria' | 'produto'
--   qualificador_id  = categoria_produto.id OU produto.id (polimórfico, sem FK)
-- recompensa_tipo: 'percentual_proximo' | 'percentual_produtos' | 'valor_fixo'
--   recompensa_valor    = % ou R$ conforme o tipo
--   recompensa_produtos = jsonb [produto_id,...] quando 'percentual_produtos'
-- prazo_resgate_dias: null = indeterminado (sem prazo)
-- status: 'ativo' | 'finalizando' (não gera novos pontos, resgates seguem) | 'encerrado'

create table if not exists fidelidade_plano (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  nome text not null,
  ativo boolean not null default true,
  status text not null default 'ativo',
  qualificador_tipo text not null default 'qualquer',
  qualificador_id uuid,
  pontos_meta integer not null default 10,
  recompensa_tipo text not null default 'percentual_proximo',
  recompensa_valor numeric not null default '0',
  recompensa_produtos jsonb not null default '[]',
  prazo_resgate_dias integer,
  criado_em timestamptz not null default now()
);
create index if not exists idx_fidelidade_plano_tenant on fidelidade_plano (tenant_id);

-- Saldo por plano. A tabela já existia como contador cru; escopamos por plano.
alter table fidelidade_cliente add column if not exists plano_id uuid;
alter table fidelidade_cliente add column if not exists cliente_id uuid;
create unique index if not exists idx_fidelidade_cliente_plano_tel
  on fidelidade_cliente (plano_id, telefone);

-- Dedupe: um pedido pontua no máximo 1 vez por plano.
create table if not exists fidelidade_ponto (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  plano_id uuid not null references fidelidade_plano(id) on delete cascade,
  telefone text not null,
  cliente_id uuid,
  pedido_id uuid,
  criado_em timestamptz not null default now()
);
create unique index if not exists idx_fidelidade_ponto_pedido_plano
  on fidelidade_ponto (pedido_id, plano_id);

-- Prêmios conquistados / resgatados (base do relatório por dia/semana/mês).
create table if not exists fidelidade_resgate (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  plano_id uuid not null references fidelidade_plano(id) on delete cascade,
  telefone text not null,
  cliente_id uuid,
  ganho_em timestamptz not null default now(),
  prazo_em timestamptz,
  resgatado_em timestamptz,
  pedido_id uuid,
  status text not null default 'disponivel'
);
create index if not exists idx_fidelidade_resgate_tel on fidelidade_resgate (tenant_id, telefone);
create index if not exists idx_fidelidade_resgate_status on fidelidade_resgate (tenant_id, status);
