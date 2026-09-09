-- @cloud-only — configuração e ENVIO de WhatsApp vivem só na nuvem. O edge não dispara
-- WhatsApp nem campanha (o worker de campanha pula em EDGE_MODE), então esta tabela não
-- é criada no banco da loja. Ver [[migrations-cloud-only-regra-edge]].
--
-- 225_whatsapp_numero.sql — modelo de NÚMEROS de WhatsApp por PAPEL × PROVEDOR.
-- Substitui (sem remover) as colunas espalhadas em cardapio_config: `provedor`,
-- `evolution_instancia`, `marketing_instancia`, `wa_cloud_phone_id/waba_id/numero`.
-- Regra: por loja há 1 número PRINCIPAL (chatbot só responde) e 1 número MARKETING
-- (disparo de campanha). O MESMO número pode ocupar os 2 papéis (2 linhas). Cada
-- número tem sua própria instância (Evolution) ou phone_number_id (Cloud oficial).
-- Idempotente (create if not exists + on conflict do nothing).

create table if not exists whatsapp_numero (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references empresa(id) on delete cascade,
  unidade_id   uuid,                         -- null = configuração da rede/tenant
  papel        text not null check (papel in ('principal','marketing')),
  provedor     text not null default 'evolution' check (provedor in ('evolution','cloud')),
  numero       text,                         -- E.164 p/ exibir (ex.: 5521999998888)
  instancia    text,                         -- nome da instância Evolution (null no cloud)
  phone_id     text,                         -- phone_number_id do Cloud (null no evolution)
  waba_id      text,                         -- WABA id do Cloud (null no evolution)
  status       text not null default 'desconectado', -- desconectado|conectando|conectado|erro
  verificado   boolean not null default false,        -- selo verificado (Meta)
  termo_aceito text,                          -- versão do termo de uso aceito (auditoria)
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- 1 número por (loja, papel). unidade_id nulo tratado como zero-uuid para o índice único.
create unique index if not exists uq_whatsapp_numero_papel
  on whatsapp_numero (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), papel);

create index if not exists idx_whatsapp_numero_tenant on whatsapp_numero (tenant_id);

-- ===== Migração de dados a partir de cardapio_config (não perde o que já existe) =====
-- PRINCIPAL: usa o provedor ATIVO da loja (cardapio_config.provedor).
insert into whatsapp_numero (tenant_id, unidade_id, papel, provedor, numero, instancia, phone_id, waba_id, status)
select cc.tenant_id, cc.unidade_id, 'principal', coalesce(cc.provedor, 'evolution'),
       coalesce(cc.wa_cloud_numero, cc.whatsapp),
       case when coalesce(cc.provedor, 'evolution') = 'evolution' then cc.evolution_instancia end,
       case when cc.provedor = 'cloud' then cc.wa_cloud_phone_id end,
       case when cc.provedor = 'cloud' then cc.wa_cloud_waba_id end,
       'desconectado'
  from cardapio_config cc
 where cc.evolution_instancia is not null
    or cc.wa_cloud_phone_id is not null
    or cc.whatsapp is not null
on conflict do nothing;

-- MARKETING: hoje só existe 2º número na Evolution (marketing_instancia).
insert into whatsapp_numero (tenant_id, unidade_id, papel, provedor, instancia, status)
select cc.tenant_id, cc.unidade_id, 'marketing', 'evolution', cc.marketing_instancia, 'desconectado'
  from cardapio_config cc
 where cc.marketing_instancia is not null
on conflict do nothing;
