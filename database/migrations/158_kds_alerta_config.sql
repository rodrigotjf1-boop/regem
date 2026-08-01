-- 158 — Motor de alertas do KDS (Fase B).
-- Alertas cadastrados pelo presidente/C&O/gerente que aparecem no RODAPÉ do KDS.
-- Dois tipos:
--   agendado    → dispara em horários (HH:MM) nos dias da semana marcados (recorrência).
--   condicional → dispara quando uma condição é atingida (ex.: X pedidos acumulados).
-- duracao_seg = quanto tempo o alerta fica no rodapé (a sobreposição/override é no cliente).
create table if not exists kds_alerta_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  titulo text not null,
  detalhe text,
  prioridade text not null default 'alta',          -- danger | alta | info | ok
  tipo text not null default 'agendado',            -- agendado | condicional
  -- agendado
  horarios jsonb not null default '[]'::jsonb,       -- ["11:00","15:00"]
  dias_semana jsonb not null default '[0,1,2,3,4,5,6]'::jsonb, -- 0=dom .. 6=sáb
  -- condicional: { fonte, operador, limiar }
  --   fonte: 'pedidos_balcao' | 'pedidos_delivery' | 'pedidos_total' | 'externo'
  --   operador: '>=' | '>' | '<=' | '<' | '=='
  --   limiar: número
  condicao jsonb,
  duracao_seg integer not null default 60,
  ativo boolean not null default true,
  criado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_kds_alerta_cfg_tenant on kds_alerta_config(tenant_id) where ativo;
