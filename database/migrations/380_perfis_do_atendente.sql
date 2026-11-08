-- @cloud-only
-- 380 · O PERFIL DO ATENDENTE VIRTUAL POR CANAL (F2 do atendente virtual, 07/11/2026 — pedido do dono: "perfis diferentes
-- de atendimento… profissional, cordial e gentil, e outros disponíveis", "um para horário de funcionamento e outro fora" e
-- "o perfil pode ser para cada tipo de ação: WhatsApp, Direct, Messenger do Facebook, comentários"; protótipo
-- `mockups/regem-central-atendimento.html`, versão 11, grupo "Perfil do atendente virtual" dos ajustes). Só NUVEM: o robô,
-- o Direct e a `robo_config` moram lá (no servidor da loja não há robô — V1).
--
-- O que entra (na `robo_config` da empresa; sem linha ou sem a chave do canal, valem os padrões):
--   atendente_perfis — um objeto por canal onde o atendente virtual já fala (nesta fase: `whatsapp` e `direct`):
--     { "whatsapp": { "perfil": "cordial", "foraDoHorario": "objetivo", "jeito": "trate o cliente por você" }, … }
--     perfil        — 'hoje' (Como hoje: nasce assim, nada muda até a loja escolher), 'profissional', 'cordial', 'gentil',
--                     'descontraido', 'objetivo' ou 'acolhedor';
--     foraDoHorario — 'mesmo' (padrão) ou um dos perfis (sem 'hoje'): o perfil quando a equipe não está (o horário da
--                     equipe, mig 379);
--     jeito         — o "jeito da loja": texto curto opcional (até 300 letras, uma linha), que vai depois do perfil.
-- A regra das escolhas mora no código (`cardapio/perfis-do-atendente.ts`): quem lê normaliza (valor estranho → padrão) e
-- quem grava confere antes — e grava SÓ o campo do canal que mudou, mesclando no banco (V82). Aqui, só a forma: objeto.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Só `alter` na `robo_config` (nenhuma FK nova
-- para `empresa` — ERR-362). O `lock_timeout` desiste em vez de enfileirar escrita atrás da tabela.
set local lock_timeout = '5s';

alter table robo_config add column if not exists atendente_perfis jsonb not null default '{}'::jsonb;
do $$ begin
  alter table robo_config add constraint ck_robo_config_atendente_perfis check (jsonb_typeof(atendente_perfis) = 'object');
exception when duplicate_object then null; end $$;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'robo_config: atendente_perfis (jsonb, não nulo)' as objeto,
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config'
           and column_name = 'atendente_perfis' and data_type = 'jsonb' and is_nullable = 'NO') as ok
union all
select 'regra: atendente_perfis é um objeto',
       (select count(*) = 1 from pg_constraint where conname = 'ck_robo_config_atendente_perfis')
union all
select 'padrão: objeto vazio (todos os canais "Como hoje")',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config'
           and column_name = 'atendente_perfis' and column_default like '''{}''::jsonb%');
