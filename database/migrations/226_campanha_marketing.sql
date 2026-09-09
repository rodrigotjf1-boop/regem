-- @cloud-only — campanhas de marketing vivem só na nuvem (worker pula em EDGE_MODE).
--
-- 226_campanha_marketing.sql — enriquece o sistema de campanhas (épico WhatsApp 2
-- provedores): tipo de campanha, imagem/link, agendamento (dias/horários/tetos),
-- cupom vinculado, e LISTA DE EXCLUSÃO (opt-out) por telefone. Tudo aditivo/idempotente.

-- ===== Campanha: conteúdo + agendamento + tipo + cupom =====
alter table campanha add column if not exists tipo text not null default 'avulsa';
  -- avulsa | frete_gratis | cupom | recuperacao | campeoes | aniversario | peca_de_novo | vip | fim_de_semana
alter table campanha add column if not exists link text;          -- link opcional no disparo
alter table campanha add column if not exists imagem_ref text;     -- imagem de marketing (Supabase Storage)
alter table campanha add column if not exists dias_semana jsonb;   -- [0..6] (0=dom) ou null = todos
alter table campanha add column if not exists hora_inicio time;    -- janela de disparo (início)
alter table campanha add column if not exists hora_fim time;       -- janela de disparo (fim)
alter table campanha add column if not exists teto_semana integer; -- alcance máx. por semana
alter table campanha add column if not exists teto_mes integer;    -- alcance máx. por mês
alter table campanha add column if not exists cupom_codigo text;   -- cupom vinculado (criado auto se pedido)
alter table campanha add column if not exists agendada boolean not null default false; -- recorrente/agendada
alter table campanha add column if not exists inicia_em timestamptz;  -- início da vigência (agendada)
alter table campanha add column if not exists termina_em timestamptz; -- fim da vigência (agendada)

-- ===== Lista de EXCLUSÃO (opt-out) por telefone — cobre quem não é cliente cadastrado =====
-- Complementa cliente.opt_out_marketing (que vale só p/ clientes com registro). Aqui
-- entra qualquer número que pediu SAIR (palavra-chave), foi excluído manual, ou via link.
create table if not exists marketing_optout (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references empresa(id) on delete cascade,
  telefone   text not null,
  cliente_id uuid,
  motivo     text,        -- 'palavra_chave' | 'manual' | 'link'
  criado_em  timestamptz not null default now()
);
create unique index if not exists uq_marketing_optout on marketing_optout (tenant_id, telefone);
create index if not exists idx_marketing_optout_tenant on marketing_optout (tenant_id);
