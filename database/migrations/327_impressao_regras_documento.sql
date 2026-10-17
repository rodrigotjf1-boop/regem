-- 327 — Central de impressão, fase 2: ONDE CADA DOCUMENTO SAI (regras por documento).
--
-- Teste do dono na loja (17/10/2026): a via sem impressora escolhida ia para TODAS as impressoras
-- de cupom (a USB do delivery e as do servidor). Decisões do mesmo dia ("1A 2A 3A" e "mais de um
-- local para sair"): cada documento tem a sua lista de impressoras, com as vias de cada uma.
--
--  • `delivery_config.impressao_regras` (jsonb): por loja (ou da rede, unidade nula), como os perfis
--    de cupom. Formato:
--      { "balcao":     { "pdv": true, "pdvVias": 1, "impressoras": [{ "id": <uuid>, "vias": 1 }] },
--        "delivery":   { "impressoras": [{ "id": <uuid>, "vias": 1 }] },
--        "entregador": { "mesmasDoDelivery": true, "impressoras": [] } }
--    Documento sem regra = como sempre (a via do delivery sem impressora escolhida sai em todas as de
--    cupom, com aviso na tela — decisão 1A). `delivery_config` já sincroniza: o servidor da loja que
--    ainda não tem a coluna ignora o campo no pull (o sync grava só as colunas que a tabela tem).
--  • `impressao_job.vias`: quantas vias deste documento nesta impressora; vazio = as da impressora
--    (`vias_cliente`/`vias`). A fila não sincroniza (cada banco tem a sua).
--
-- NÃO é @cloud-only: as duas tabelas existem nos dois bancos. Idempotente.
set local lock_timeout = '5s';

alter table delivery_config add column if not exists impressao_regras jsonb not null default '{}'::jsonb;
alter table impressao_job add column if not exists vias integer;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'delivery_config.impressao_regras (jsonb, obrigatória, padrão {})' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'delivery_config'
                  and column_name = 'impressao_regras' and data_type = 'jsonb' and is_nullable = 'NO') as ok
union all
select 'impressao_job.vias (integer, opcional)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'impressao_job'
                  and column_name = 'vias' and data_type = 'integer' and is_nullable = 'YES');
