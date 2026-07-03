-- 015_equipamento.sql — Fase F-A: apps satélites (KDS / Terminal de Ponto) + tempo real.
-- Introduz o "equipamento" (device) que fala com o app principal via WebSocket na rede local.
-- Também move o NSR do ponto para ser sequencial POR EQUIPAMENTO (fiel à Portaria 671/2021),
-- em vez de por tenant. Registros legados são reatribuídos a um REP-Software padrão por
-- (tenant, unidade), preservando o NSR original (append-only, nada é apagado).
-- ⚠️ CREATE/ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs).

-- 1) Equipamentos (KDS e Terminal de Ponto). Base de device-auth e dos módulos ativáveis.
create table if not exists equipamento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid references unidade(id),
  tipo text not null,                    -- kds | terminal_ponto
  nome text not null,
  token text not null unique,            -- segredo do handshake WebSocket do device
  mac text,                              -- opcional (descoberta na rede local — app nativo)
  padrao boolean not null default false, -- REP-Software lógico p/ marcações web/gestor
  ativo boolean not null default true,
  ultimo_ping timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_equipamento_tenant on equipamento (tenant_id);
create index if not exists idx_equipamento_unidade on equipamento (unidade_id);

-- 2) Vincula cada marcação ao equipamento que a originou.
alter table ponto_marcacao add column if not exists equipamento_id uuid references equipamento(id);

-- 3) Backfill: um REP-Software padrão por (tenant, unidade) presente no histórico.
insert into equipamento (tenant_id, unidade_id, tipo, nome, token, padrao, ativo)
select distinct m.tenant_id, m.unidade_id, 'terminal_ponto', 'REP-Software (legado)',
       md5(random()::text || clock_timestamp()::text || coalesce(m.unidade_id::text, 'null')),
       true, true
from ponto_marcacao m
where m.equipamento_id is null;

update ponto_marcacao m
set equipamento_id = e.id
from equipamento e
where e.padrao = true
  and e.tenant_id = m.tenant_id
  and e.unidade_id is not distinct from m.unidade_id
  and m.equipamento_id is null;

-- 4) NSR agora é único POR EQUIPAMENTO (não mais por tenant).
drop index if exists idx_ponto_nsr;
create unique index if not exists idx_ponto_nsr_equip
  on ponto_marcacao (tenant_id, equipamento_id, nsr);
