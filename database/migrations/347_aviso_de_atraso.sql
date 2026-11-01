-- @cloud-only
-- 347 · AVISO AUTOMÁTICO DE ATRASO AO CLIENTE (Bloco 5 do plano do robô, aprovado pelo dono; 01/11/2026).
-- Só NUVEM, como a 342 (robo_config) e a 215 (whatsapp_mensagem): o aviso sai pelo WhatsApp OFICIAL, que só a nuvem
-- alcança; a loja não tem estas tabelas.
--
-- O que entra:
--   robo_config.aviso_atraso — a loja liga o aviso (NASCE DESLIGADO). Ligado, o pedido do cardápio próprio (entrega ou
--     retirada) que passar do tempo prometido ao cliente (cardapio_config.tempo_entrega_min / tempo_retirada_min, contado
--     da entrada do pedido) mais a tolerância recebe UMA vez o aviso "Pedido atrasando" (texto na janela de 24 h; fora
--     dela, o modelo `pedido_atrasado`).
--   robo_config.aviso_atraso_tolerancia_min — quantos minutos além do prometido antes de avisar (padrão 10; 0 a 120).
--   pedido_aviso_atraso — "já avisei este pedido": uma linha por pedido, gravada ANTES do envio (insert … on conflict do
--     nothing): duas réplicas da API, ou duas voltas da rotina, nunca mandam o aviso duas vezes (V24, V42).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Colunas com padrão em tabela pequena
-- (uma linha por loja) e tabela nova vazia; o `lock_timeout` desiste em vez de enfileirar escrita atrás dela.
set local lock_timeout = '5s';

alter table robo_config add column if not exists aviso_atraso boolean not null default false;
alter table robo_config add column if not exists aviso_atraso_tolerancia_min integer not null default 10;

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.conname = 'ck_robo_config_aviso_atraso_tolerancia'
       and t.relname = 'robo_config'
       and n.nspname = current_schema()
  ) then
    alter table robo_config
      add constraint ck_robo_config_aviso_atraso_tolerancia check (aviso_atraso_tolerancia_min between 0 and 120);
  end if;
end $$;

create table if not exists pedido_aviso_atraso (
  pedido_id   uuid primary key,
  tenant_id   uuid not null references empresa(id) on delete cascade,
  enviado_em  timestamptz not null default now()
);

create index if not exists pedido_aviso_atraso_tenant_idx on pedido_aviso_atraso (tenant_id, enviado_em desc);
