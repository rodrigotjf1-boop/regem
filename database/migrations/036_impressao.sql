-- Fase F3 — Impressão térmica (ESC/POS) via servidor local (edge).
-- Pedido roteado para destino 'impressora' vira um job; o worker no edge
-- (token 'servidor_local') puxa os pendentes e imprime na impressora (host:porta).

-- Endereço da impressora de rede (destino tipo 'impressora').
alter table equipamento add column if not exists host text;
alter table equipamento add column if not exists porta integer;

create table if not exists impressao_job (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  equipamento_id uuid,          -- impressora destino (host/porta)
  pedido_id uuid,               -- producao_pedido de origem
  via text not null default 'producao', -- producao | conferencia (futuro)
  conteudo text not null,       -- ticket em texto (worker converte p/ ESC/POS)
  status text not null default 'pendente', -- pendente | impresso | erro
  tentativas integer not null default 0,
  erro text,
  criado_em timestamptz not null default now(),
  impresso_em timestamptz
);
create index if not exists idx_impressao_status on impressao_job(tenant_id, status);
create index if not exists idx_impressao_equip on impressao_job(equipamento_id, status);
