-- 027_bot_suporte.sql — Bot de Suporte (regras por palavra-chave + log de atendimento).
-- ⚠️ CREATE — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.
-- Não é IA generativa: o bot casa GATILHOS (palavras-chave) e devolve a resposta
-- predefinida; pode escalar ao gerente (nunca | sempre | condicional).

create table if not exists bot_regra (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  tipo text not null,                       -- ex.: 'Pedido atrasado'
  gatilhos text not null,                   -- palavras-chave separadas por vírgula
  resposta text not null,
  escala text not null default 'nunca',     -- 'nunca' | 'sempre' | 'condicional'
  escala_condicao text,                     -- ex.: 'Se > 15 min' (livre)
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_bot_regra_tenant on bot_regra (tenant_id);

-- Log de atendimentos (métrica "N hoje · M escalados"). Guarda a pergunta e se casou/escalou.
create table if not exists bot_atendimento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid references colaborador(id),
  pergunta text not null,
  regra_id uuid references bot_regra(id) on delete set null,
  escalado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists idx_bot_atendimento_tenant on bot_atendimento (tenant_id, created_at desc);
