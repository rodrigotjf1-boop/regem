-- 031_alerta_estoque.sql — Persistência dos alertas de estoque (ROP + FEFO).
-- Antes eram só eventos efêmeros de tempo real; agora sobrevivem, listam e se resolvem.
-- ⚠️ CREATE — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.
--
-- Dedup: mantém UM alerta aberto por (tenant, tipo) — o cron atualiza o existente
-- em vez de empilhar. Índice parcial garante a unicidade só entre os NÃO resolvidos.

create table if not exists alerta_estoque (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  tipo text not null,                       -- 'ponto_pedido' | 'validade'
  titulo text not null,
  detalhe text,
  prioridade text not null default 'alta',  -- 'alta' | 'danger'
  criado_em timestamptz not null default now(),
  resolvido_em timestamptz,
  resolvido_por uuid
);
create index if not exists idx_alerta_estoque_tenant
  on alerta_estoque (tenant_id, resolvido_em);
create unique index if not exists idx_alerta_estoque_aberto
  on alerta_estoque (tenant_id, tipo)
  where resolvido_em is null;
