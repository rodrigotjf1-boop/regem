-- @cloud-only
-- 207_entregador_fechamento_periodo.sql — Fase 3 do app do entregador (cloud-only).
-- O módulo entregador é @CloudOnly (roda só na nuvem), então isto NÃO vai pro edge.
--
-- 1) Base dos ganhos: 'real' (soma a taxa_entrega REAL de cada pedido, padrão) ou
--    'fixa' (valor fixo por entrega = taxa_entrega_centavos). Configurável por loja e
--    por entregador.
-- 2) Periodicidade do fechamento: 'dia' | 'semana' | 'quinzena' (cada loja usa a sua).
-- 3) Fechamento ganha período (início/fim), base e o vínculo com a sangria do caixa.
-- 4) pedido_externo.entregador_fechamento_id marca o pedido como JÁ ACERTADO (evita
--    pagar duas vezes). Cloud-only: só o módulo entregador (nuvem) lê; o sync ignora
--    a coluna no edge (upsert filtra por colunas existentes), sem quebrar nada.
-- Aditiva e idempotente.

alter table entregador_config
  add column if not exists base_taxa     text not null default 'real',   -- real | fixa
  add column if not exists periodicidade text not null default 'dia';    -- dia | semana | quinzena

alter table entregador_perfil_pagamento
  add column if not exists base_taxa     text not null default 'real',
  add column if not exists periodicidade text not null default 'dia';

alter table entregador_fechamento
  add column if not exists periodo_inicio      date,
  add column if not exists periodo_fim         date,
  add column if not exists base_taxa           text,
  add column if not exists lancamento_caixa_id uuid;

alter table pedido_externo
  add column if not exists entregador_fechamento_id uuid;

create index if not exists idx_pedido_externo_entregador_fechamento
  on pedido_externo (tenant_id, entregador_id, entregador_fechamento_id);

-- O fechamento passa a ser APPEND-ONLY por PAGAMENTO (não "1 por dia"): um período pode
-- ser pago em mais de um acerto, e a proteção contra pagar 2x é a marcação
-- pedido_externo.entregador_fechamento_id (não o data_ref). Solta a unicidade por dia.
drop index if exists ux_entregador_fechamento_dia;
