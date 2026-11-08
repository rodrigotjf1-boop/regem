-- @cloud-only
-- 381 · OS ASSUNTOS QUE NÃO SÃO PEDIDO (F3 do atendente virtual, 07/11/2026 — pedido do dono: "no Direct vêm dúvidas de
-- pedido, mas também temas mais complexos: fornecedores tentando contato com o responsável, pessoas perguntando sobre
-- emprego — a ideia é o nosso atendimento virtual administrar isso"; protótipo `mockups/regem-central-atendimento.html`,
-- versão 12, grupo "Assuntos que não são pedido" dos ajustes). Só NUVEM: o robô, o Direct e a `robo_config` moram lá (no
-- servidor da loja não há robô — V1).
--
-- O que entra (na `robo_config` da empresa; sem linha ou sem a chave do assunto, valem os padrões):
--   atendente_assuntos — um objeto por assunto que não é pedido:
--     { "fornecedor": { "modo": "recado", "texto": "…" }, "vaga": { "modo": "nao" }, … }
--     assuntos — 'fornecedor' (fornecedor ou proposta comercial), 'vaga' (vaga de emprego) e 'parceria' (parceria,
--                influenciador ou imprensa);
--     modo     — 'hoje' (Como hoje: chama a equipe — nasce assim, nada muda até a loja escolher), 'recado' (o robô pergunta
--                o mínimo e deixa um RECADO PARA O RESPONSÁVEL: fora da fila da equipe, só gerente e presidente veem) ou
--                'nao' (responde que não é por aqui, sem chamar ninguém);
--     texto    — o que o robô diz no fim (até 300 letras, uma linha); sem texto, o padrão do assunto.
-- A regra das escolhas mora no código (`cardapio/assuntos-do-atendente.ts`): quem lê normaliza (valor estranho → padrão) e
-- quem grava confere antes — e grava SÓ o campo do assunto que mudou, mesclando no banco (V82). Aqui, só a forma: objeto.
-- O recado em si não muda a estrutura de `atendimento_chamado` (que sincroniza): vai em `detalhe.responsavel`.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Só `alter` na `robo_config` (nenhuma FK nova
-- para `empresa` — ERR-362). O `lock_timeout` desiste em vez de enfileirar escrita atrás da tabela.
set local lock_timeout = '5s';

alter table robo_config add column if not exists atendente_assuntos jsonb not null default '{}'::jsonb;
do $$ begin
  alter table robo_config add constraint ck_robo_config_atendente_assuntos check (jsonb_typeof(atendente_assuntos) = 'object');
exception when duplicate_object then null; end $$;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'robo_config: atendente_assuntos (jsonb, não nulo)' as objeto,
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config'
           and column_name = 'atendente_assuntos' and data_type = 'jsonb' and is_nullable = 'NO') as ok
union all
select 'regra: atendente_assuntos é um objeto',
       (select count(*) = 1 from pg_constraint where conname = 'ck_robo_config_atendente_assuntos')
union all
select 'padrão: objeto vazio (todos os assuntos "Como hoje")',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config'
           and column_name = 'atendente_assuntos' and column_default like '''{}''::jsonb%');
