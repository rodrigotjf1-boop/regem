-- @cloud-only
-- 383 · O ATENDENTE VIRTUAL NO CHAT DO iFOOD E DA 99 (F5 do atendente virtual, 08/11/2026 — o robô com IA responde no chat
-- da plataforma pela ponte do chat; protótipo `mockups/regem-central-atendimento.html`). Só NUVEM: o robô (o fluxo do n8n),
-- a ponte do chat, a `robo_config` e a conversa de teste moram lá (no servidor da loja não há robô — V1).
--
-- O que entra:
--   robo_config.chat_robo_modo — QUEM responde no chat quando "Robô responde no chat" (`chat_robo_responde`) está ligado:
--     'regras'    — o robô por regras de hoje (o "cadê meu pedido" com o dado do pedido; o resto chama a equipe). Nasce
--                   assim: nada muda até a loja escolher;
--     'atendente' — o atendente virtual (o robô com IA do n8n), com a trava da plataforma (até 300 letras por mensagem,
--                   nada de telefone, WhatsApp, Instagram ou link) aplicada ao que ele escreve.
--   chat_plataforma_msg.robo_ia — a fala que o ATENDENTE VIRTUAL escreveu (autor 'robo' com a marca): a tela oferece
--     "Corrigir" só nelas. As frases fixas do robô por regras e o "já chamei a equipe" ficam `false`.
--   chat_plataforma_msg.robo_entregue_em — a fala do CLIENTE que foi entregue ao atendente virtual e ainda espera a resposta
--     dele. A resposta (ou o caso que a equipe já tem) apaga a marca; a rotina de cada minuto acha as marcas com mais de
--     2 minutos e abre o caso ("o atendente virtual não respondeu" — V88). O índice parcial guarda só as marcas vivas:
--     é pequeno e a rotina lê só ele (V84).
--   atendente_teste.plataforma — a conversa de TESTE do atendente no chat do iFood ('ifood'; '99food' fica previsto): a
--     coluna `canal` (check só 'whatsapp' | 'direct', e esta migration não pode ter `drop`) fica 'whatsapp' por baixo e a
--     API mostra `canal: 'chat'` para a tela. Nula = o teste de WhatsApp ou Direct de antes.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Só `alter` e índice em tabelas que já existem
-- (nenhuma FK nova para `empresa` — ERR-362/377). O `lock_timeout` desiste em vez de enfileirar escrita atrás das tabelas.
set local lock_timeout = '5s';

alter table robo_config add column if not exists chat_robo_modo text not null default 'regras';
do $$ begin
  alter table robo_config add constraint ck_robo_config_chat_robo_modo check (chat_robo_modo in ('regras', 'atendente'));
exception when duplicate_object then null; end $$;

alter table chat_plataforma_msg add column if not exists robo_ia boolean not null default false;
alter table chat_plataforma_msg add column if not exists robo_entregue_em timestamptz;
create index if not exists idx_chat_msg_robo_entregue on chat_plataforma_msg (robo_entregue_em) where robo_entregue_em is not null;

alter table atendente_teste add column if not exists plataforma text;
do $$ begin
  alter table atendente_teste add constraint ck_atendente_teste_plataforma check (plataforma is null or plataforma in ('ifood', '99food'));
exception when duplicate_object then null; end $$;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'robo_config: chat_robo_modo (texto, não nulo, padrão regras)' as objeto,
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config' and column_name = 'chat_robo_modo'
           and data_type = 'text' and is_nullable = 'NO' and column_default like '''regras''%') as ok
union all
select 'regra: chat_robo_modo é regras ou atendente',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname = 'ck_robo_config_chat_robo_modo')
union all
select 'chat_plataforma_msg: robo_ia (booleano, não nulo, padrão false)',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'chat_plataforma_msg' and column_name = 'robo_ia'
           and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false')
union all
select 'chat_plataforma_msg: robo_entregue_em (data e hora)',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'chat_plataforma_msg' and column_name = 'robo_entregue_em'
           and data_type = 'timestamp with time zone')
union all
select 'índice parcial idx_chat_msg_robo_entregue (só as marcas vivas)',
       (select count(*) = 1 from pg_indexes x
         where x.schemaname = current_schema() and x.indexname = 'idx_chat_msg_robo_entregue' and x.indexdef like '%WHERE (robo_entregue_em IS NOT NULL)%')
union all
select 'atendente_teste: plataforma (texto)',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'atendente_teste' and column_name = 'plataforma' and data_type = 'text')
union all
select 'regra: plataforma do teste é ifood ou 99food (ou nula)',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname = 'ck_atendente_teste_plataforma');
