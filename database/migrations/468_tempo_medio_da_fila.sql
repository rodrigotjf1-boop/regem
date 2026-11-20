-- @cloud-only
-- 468 · TEMPO MÉDIO PARA RESOLVER UM CASO (fase C1 do `docs/plano-clube-e-banner.md`; protótipo
-- `mockups/regem-clube-banner.html`, parte "Tempo da fila", aprovado pelo dono em 20/11/2026 com as recomendadas — D10:
-- "definido pela loja, com o medido ao lado"). Só NUVEM, como a 342 (robo_config) e a 442: o robô e a fila moram na nuvem;
-- a loja não tem esta tabela.
--
-- O que entra:
--   robo_config.tempo_medio_min — Atendimento › Ajustes › "Fila e avisos" › "Tempo médio para resolver um caso", em
--     minutos (1 a 240). VAZIO (o padrão) = o robô não fala de tempo, como hoje. Com o tempo, a resposta do
--     chamar_atendente traz o tempo estimado em faixas (posição × tempo médio: até 10 min, cerca de 15, 20, 30, 40, mais
--     de 40), e o robô diz quanto a equipe costuma levar — nunca promete.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Coluna sem padrão (nula) em tabela pequena
-- (uma linha por empresa): não reescreve a tabela; o `lock_timeout` desiste em vez de enfileirar escrita atrás dela.
set local lock_timeout = '5s';

alter table robo_config add column if not exists tempo_medio_min smallint
  constraint robo_config_tempo_medio_min_faixa check (tempo_medio_min between 1 and 240);

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'robo_config.tempo_medio_min (nula, sem padrão)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_config'
                  and column_name = 'tempo_medio_min' and is_nullable = 'YES' and column_default is null) as ok
union all
-- Pelo catálogo (pg_constraint), não pelo information_schema (a conexão de leitura não vê a tabela pelo outro — 10/11).
select 'a faixa de 1 a 240 minutos',
       exists (select 1 from pg_constraint c
                where c.conrelid = to_regclass(current_schema() || '.robo_config') and c.contype = 'c'
                  and c.conname = 'robo_config_tempo_medio_min_faixa');
