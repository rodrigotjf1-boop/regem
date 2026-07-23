-- 134_pedidos_manutencao.sql — Pedidos de manutenção (menu "Tarefas").
-- Colaborador registra equipamento com defeito / lâmpada queimada / mau funcionamento
-- (até 3 fotos). Cria alerta ao presidente/C&O; só ele muda status ou delega ao gerente.
-- Status: aberto | em_andamento | concluido_parcial | concluido | cancelado.
-- Job diário: sem conclusão em 15 dias → pergunta ao C&O (manter/concluir/excluir). Idempotente.

create table if not exists pedido_manutencao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,

  -- O QUÊ
  equipamento_id uuid,                       -- opcional: aponta p/ equipamento cadastrado
  equipamento_ref text,                      -- texto livre quando não há cadastro
  titulo text not null,
  descricao text,
  fotos jsonb not null default '[]',         -- refs de mídia (máx 3 — validado no serviço)
  prioridade text not null default 'normal', -- baixa | normal | alta | critica

  -- ESTADO
  status text not null default 'aberto',     -- aberto|em_andamento|concluido_parcial|concluido|cancelado
  criado_por_id uuid,
  responsavel_id uuid,                       -- gerente delegado pelo C&O
  delegado_em timestamptz,

  -- SLA / escala 15 dias
  prazo_15d date,                            -- criado_em + 15d (preenchido no serviço)
  alerta_15d_em timestamptz,                 -- quando o job perguntou ao C&O
  decisao_15d text,                          -- manter | concluir | excluir

  resolvido_em timestamptz,
  resolvido_por_id uuid,
  motivo text,                               -- cancelamento / observação de conclusão parcial

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_pedido_manutencao_abertos
  on pedido_manutencao (tenant_id, status)
  where deleted_at is null;
