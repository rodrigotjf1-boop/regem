-- @cloud-only
-- 388 · O CLIENTE DA 99 PELO WHATSAPP DA LOJA (pedido do dono, 09/11/2026: "na 99 como temos o contato o link de rastreio
-- vai ser enviado como no cardápio digital para o contato do cliente" + o "compartilhar a minha posição" do entregador
-- para o cliente do cardápio digital e da 99). Só NUVEM, como a 342 (robo_config) e a 347: os avisos saem pelo WhatsApp
-- da loja (oficial ou por QR), que só a nuvem alcança; a loja não tem estas tabelas.
--
-- O que entra:
--   robo_config.cliente_99_whatsapp — a loja liga (NASCE DESLIGADO; Delivery › Configurações › Robô de atendimento ›
--     "Falar com o cliente da 99 pelo WhatsApp"). Ligado, no pedido da 99 com ENTREGA DA LOJA (delivery_type = 2) o cliente recebe pelo
--     WhatsApp da loja: o "saiu para entrega" com o link de rastreio, o "o entregador está chegando" (a cerca de 70 m e o
--     botão do app), o "não consigo falar com você" e a posição do entregador. O iFood continua fora (termo do iFood:
--     o cliente não pode ser levado a outro canal — ERR-342); a entrega feita pelo entregador da 99 também (quem avisa é
--     a 99).
--   pedido_aviso_99 — "já mandei este aviso a este pedido": uma linha por pedido e aviso, gravada ANTES do envio
--     (insert … on conflict do nothing) — duas réplicas da API ou duas voltas da rotina nunca mandam o "saiu" duas
--     vezes (V24, V42).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Coluna com padrão em tabela pequena (uma
-- linha por loja) e tabela nova vazia; o `lock_timeout` desiste em vez de enfileirar escrita atrás dela.
set local lock_timeout = '5s';

alter table robo_config add column if not exists cliente_99_whatsapp boolean not null default false;

create table if not exists pedido_aviso_99 (
  pedido_id   uuid not null,
  evento      text not null,
  tenant_id   uuid not null references empresa(id) on delete cascade,
  enviado_em  timestamptz not null default now(),
  primary key (pedido_id, evento)
);

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.conname = 'ck_pedido_aviso_99_evento'
       and t.relname = 'pedido_aviso_99'
       and n.nspname = current_schema()
  ) then
    alter table pedido_aviso_99 add constraint ck_pedido_aviso_99_evento check (evento in ('saiu_entrega'));
  end if;
end $$;

create index if not exists pedido_aviso_99_tenant_idx on pedido_aviso_99 (tenant_id, enviado_em desc);

-- O telefone do cliente não mora aqui, mas a tabela é de pedido de cliente: fora do alcance da API REST anônima do
-- Supabase (RLS ligada e SEM política, como a 342, a 347 e a 366 — o app usa um papel que atravessa a RLS).
alter table pedido_aviso_99 enable row level security;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'robo_config.cliente_99_whatsapp' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_config'
                  and column_name = 'cliente_99_whatsapp' and column_default = 'false') as ok
union all
select 'tabela pedido_aviso_99 com a chave (pedido, aviso)',
       (select count(*) = 2 from information_schema.key_column_usage k
          join information_schema.table_constraints c on c.constraint_name = k.constraint_name and c.table_schema = k.table_schema
         where k.table_schema = current_schema() and k.table_name = 'pedido_aviso_99' and c.constraint_type = 'PRIMARY KEY')
union all
select 'RLS ligada em pedido_aviso_99',
       coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass(current_schema() || '.pedido_aviso_99')), false);
