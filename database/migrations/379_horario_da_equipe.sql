-- @cloud-only
-- 379 · O HORÁRIO DA EQUIPE (F1 do atendente virtual, 07/11/2026 — pedido do dono: "o robô administra o atendimento; a
-- mensagem só vai ao atendimento humano quando o robô não resolve; o atendimento humano só está disponível no horário em
-- que a loja funciona — fora desse horário fica basicamente off"; protótipo `mockups/regem-central-atendimento.html`,
-- versão 10, grupo "Horário da equipe" dos ajustes). Só NUVEM: o robô, o Direct, a ponte do chat e a `robo_config` moram
-- lá (no servidor da loja a equipe atende "sempre" — V1).
--
-- O que entra (todas na `robo_config` da empresa; sem linha, valem os padrões):
--   equipe_atende     — 'sempre' (como hoje: nasce assim, nada muda até a loja escolher) ou 'loja' (no horário da loja,
--                       o de Delivery › Configurações › Horários — `cardapio_config.horarios`/`horarios_retirada`).
--   equipe_antes_min  — "Começa a atender": 0, 30 ou 60 min antes de abrir (padrão 30).
--   equipe_depois_min — "Para de atender": 0, 30, 60 ou 120 min depois de fechar (padrão 60 — as últimas entregas).
--   equipe_fora_texto — "Fora do horário, o robô diz" (até 300 letras; {volta} vira "hoje às 17:30"…). Nulo = o padrão.
-- Fora do horário, o caso que o robô passaria para a equipe vira RECADO PARA A ABERTURA (`atendimento_chamado.detalhe.recado`
-- = { ate, em } — sem coluna nova: a tabela sincroniza com o servidor da loja e o `detalhe` já viaja inteiro).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Só `alter` na `robo_config` (nenhuma FK nova
-- para `empresa` — ERR-362). O `lock_timeout` desiste em vez de enfileirar escrita atrás da tabela.
set local lock_timeout = '5s';

alter table robo_config add column if not exists equipe_atende text not null default 'sempre';
alter table robo_config add column if not exists equipe_antes_min integer not null default 30;
alter table robo_config add column if not exists equipe_depois_min integer not null default 60;
alter table robo_config add column if not exists equipe_fora_texto text;
do $$ begin
  alter table robo_config add constraint ck_robo_config_equipe_atende check (equipe_atende in ('sempre', 'loja'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table robo_config add constraint ck_robo_config_equipe_antes_min check (equipe_antes_min in (0, 30, 60));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table robo_config add constraint ck_robo_config_equipe_depois_min check (equipe_depois_min in (0, 30, 60, 120));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table robo_config add constraint ck_robo_config_equipe_fora_texto
    check (equipe_fora_texto is null or char_length(equipe_fora_texto) <= 300);
exception when duplicate_object then null; end $$;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'robo_config: equipe_atende, equipe_antes_min, equipe_depois_min, equipe_fora_texto' as objeto,
       (select count(*) = 4 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config'
           and column_name in ('equipe_atende', 'equipe_antes_min', 'equipe_depois_min', 'equipe_fora_texto')) as ok
union all
select 'regras sempre/loja, 0/30/60, 0/30/60/120 e até 300 letras',
       (select count(*) = 4 from pg_constraint
         where conname in ('ck_robo_config_equipe_atende', 'ck_robo_config_equipe_antes_min',
                           'ck_robo_config_equipe_depois_min', 'ck_robo_config_equipe_fora_texto'))
union all
select 'padrão: sempre, 30 min antes, 1 h depois, texto padrão',
       (select count(*) = 3 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config'
           and ((column_name = 'equipe_atende' and column_default like '''sempre''%')
             or (column_name = 'equipe_antes_min' and column_default = '30')
             or (column_name = 'equipe_depois_min' and column_default = '60')));
