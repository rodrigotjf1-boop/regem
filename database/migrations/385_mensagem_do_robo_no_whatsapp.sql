-- @cloud-only
-- 385 · A MENSAGEM QUE O ATENDENTE VIRTUAL MANDOU NO WHATSAPP ("Corrigir no WhatsApp", 08/11/2026). A tela do caso oferece
-- "Corrigir" na fala do robô (como já faz no Direct do Instagram e no chat do iFood/99), e para isso precisa saber QUAIS
-- mensagens enviadas pela loja no WhatsApp saíram do robô — o histórico da API oficial (`whatsapp_mensagem`, mig 215) não
-- tem autor, e na Evolution (QR) o histórico mora nela, não no nosso banco.
--
-- O que entra:
--   whatsapp_do_robo — uma linha por mensagem que SAIU para o cliente pela resposta do robô (`publico/bot/responder`):
--     texto, opções (botões, lista, menu numerado, enquete), botão de link e voz. A equipe, os avisos automáticos e o pedido
--     montado pelo Regem NÃO entram (não são fala do atendente virtual). `mensagem_id` = o id da mensagem no provedor (o
--     wamid na API oficial; o `key.id` na Evolution) — o MESMO id que a caixa de conversas devolve em `GET
--     /whatsapp/mensagens`. `telefone` = o cliente, só dígitos. `criado_em` = clock_timestamp() (ERR-379). Chave primária
--     (tenant_id, mensagem_id): a gravação repetida não duplica (`on conflict do nothing` — V24) e a leitura da caixa acha
--     cada id por igualdade na chave (V85). As linhas com mais de 30 dias saem pela rotina de 6 h da nuvem (o "Corrigir" é
--     para conversa recente) — o índice por `criado_em` é o dela.
--
-- Só NUVEM (o robô e a caixa de conversas moram lá; a loja pede à nuvem) — `SO_NUVEM` no `sync-daemon.mjs`. Sem instrução
-- destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Nenhuma FK nova para tabela que já existe (ERR-377). O
-- `lock_timeout` desiste em vez de enfileirar escrita atrás das tabelas.
set local lock_timeout = '5s';

create table if not exists whatsapp_do_robo (
  tenant_id    uuid not null references empresa(id) on delete cascade,
  mensagem_id  text not null,                              -- wamid (API oficial) ou key.id (Evolution)
  telefone     text,                                       -- o cliente, só dígitos
  criado_em    timestamptz not null default clock_timestamp(),
  constraint whatsapp_do_robo_pkey primary key (tenant_id, mensagem_id)
);
-- A limpeza dos 30 dias (a rotina de 6 h da nuvem).
create index if not exists idx_whatsapp_do_robo_criado on whatsapp_do_robo (criado_em);
alter table whatsapp_do_robo enable row level security;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'whatsapp_do_robo: tabela com RLS' as objeto,
       (select count(*) = 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'whatsapp_do_robo' and c.relrowsecurity) as ok
union all
select 'whatsapp_do_robo: chave primária (tenant_id, mensagem_id)',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname = 'whatsapp_do_robo_pkey' and k.contype = 'p'
           and (select array_agg(a.attname::text order by x.ord) from unnest(k.conkey) with ordinality as x(num, ord)
                  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = x.num) = array['tenant_id', 'mensagem_id'])
union all
select 'whatsapp_do_robo: empresa apagada leva as linhas (on delete cascade)',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'whatsapp_do_robo' and k.contype = 'f'
           and k.confrelid = (select oid from pg_class where relname = 'empresa' and relnamespace = n.oid) and k.confdeltype = 'c')
union all
select 'whatsapp_do_robo: criado_em por clock_timestamp()',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'whatsapp_do_robo' and column_name = 'criado_em'
           and is_nullable = 'NO' and column_default like 'clock_timestamp()%')
union all
select 'whatsapp_do_robo: índice da limpeza por criado_em',
       (select count(*) = 1 from pg_indexes x
         where x.schemaname = current_schema() and x.tablename = 'whatsapp_do_robo' and x.indexname = 'idx_whatsapp_do_robo_criado');
