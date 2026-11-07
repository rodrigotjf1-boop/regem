-- @cloud-only
-- 378 · O ROBÔ RESPONDE NO DIRECT (F4 da Central de atendimento, 07/11/2026; protótipo
-- `mockups/regem-central-atendimento.html`, versão 8). O mesmo robô do WhatsApp (o fluxo do n8n, com as instruções do
-- Regem) atende o Direct da loja; o que ele não resolve vira caso com o resumo. Só NUVEM, como a 377: o aviso do
-- Instagram chega na nuvem e a conta mora nela (a loja não tem `instagram_conta`).
--
-- instagram_conta.robo_responde — "Robô responde no Direct" (Delivery › Configurações › Atendimento, grupo "Instagram
--   Direct"). Nasce DESLIGADO.
-- instagram_conta.cardapio_id — "Cardápio que o robô usa": o Instagram é da empresa; o horário, a taxa e o link saem do
--   cardápio desta loja. Vazio = o único cardápio da empresa (com mais de um e nenhum escolhido, o robô não liga).
--   Apagar o cardápio deixa vazio (`on delete set null`).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

alter table instagram_conta add column if not exists robo_responde boolean not null default false;
alter table instagram_conta add column if not exists cardapio_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fk_instagram_conta_cardapio') then
    alter table instagram_conta
      add constraint fk_instagram_conta_cardapio foreign key (cardapio_id) references cardapio_config(id) on delete set null;
  end if;
end $$;

-- Conferência (no mesmo Run): as duas colunas e a ligação com o cardápio.
select 'coluna' as o_que, c.column_name as nome, c.data_type || ' · padrão ' || coalesce(c.column_default, '-') as ok
  from information_schema.columns c
 where c.table_schema = current_schema() and c.table_name = 'instagram_conta' and c.column_name in ('robo_responde', 'cardapio_id')
union all
select 'restricao', t.conname, pg_get_constraintdef(t.oid)
  from pg_constraint t
 where t.conname = 'fk_instagram_conta_cardapio'
 order by 1, 2;
