-- 324 — Estação de impressão: o PC que imprime as impressoras ligadas nele (fase 1 da central de
-- impressão; desenho aprovado pelo dono em 15/10/2026).
--
-- No modo local, o servidor da loja imprime TODA a fila pelo Windows dele: a impressora USB ligada
-- num PDV, no PC do delivery ou num PC da cozinha nunca imprimia ("OpenPrinter falhou"). Cada PC com
-- impressora passa a ter uma ESTAÇÃO (equipamento do tipo `estacao_impressao`, pareado pelo código de
-- 6 dígitos), que pega na fila só as impressoras dela.
--
-- `equipamento.estacao_id`: a estação que imprime esta impressora. NULL = o servidor da loja (ou, na
--   loja sem servidor, o agente/estação de sempre) — o comportamento de hoje. Sem chave estrangeira DE
--   PROPÓSITO, como `impressora_padrao_id`: `equipamento` sincroniza nos dois sentidos e a ordem de
--   chegada da impressora e da estação não é garantida.
--
-- `impressora_status.estado` / `estado_em` / `estado_detalhe`: o que a impressora respondeu da
--   última vez (pronta, papel acabando, sem papel, tampa aberta, erro, sem resposta) e desde quando.
--   Estado de OPERAÇÃO: a tabela não sincroniza (mig 269).
--
-- NÃO é @cloud-only: as duas tabelas existem nos dois bancos. Colunas sem valor padrão não regravam a
-- tabela. Idempotente.
set local lock_timeout = '5s';

alter table equipamento add column if not exists estacao_id uuid;

create index if not exists idx_equipamento_estacao on equipamento (estacao_id) where estacao_id is not null;

alter table impressora_status add column if not exists estado text;
alter table impressora_status add column if not exists estado_em timestamptz;
alter table impressora_status add column if not exists estado_detalhe text;

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`. O índice é procurado em
-- `pg_class` (e não em `pg_indexes`, que lê a definição de todos os índices do banco — ERR-194).
select 'equipamento.estacao_id (uuid, opcional)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'equipamento'
                  and column_name = 'estacao_id' and data_type = 'uuid' and is_nullable = 'YES') as ok
union all
select 'índice idx_equipamento_estacao',
       exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = current_schema() and c.relname = 'idx_equipamento_estacao' and c.relkind = 'i')
union all
select 'impressora_status.estado, estado_em, estado_detalhe',
       (select count(*) = 3 from information_schema.columns
         where table_schema = current_schema() and table_name = 'impressora_status'
           and column_name in ('estado', 'estado_em', 'estado_detalhe'));
