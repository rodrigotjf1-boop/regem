-- @cloud-only
-- 495 — MISTER: a lista de compras lida de um arquivo fica guardada INTEIRA até virar a lista da conversa.
--
-- Em 23/11/2026 o dono mandou um PDF com cerca de 36 itens e só 11 entraram: a leitura da foto é um resumo de 600 letras, e a
-- IA montava a lista com o que coube nele. Agora as linhas são lidas à parte e guardadas aqui, e a ferramenta monta a lista
-- com elas, sem a IA copiar nada.
--
-- mister_lista_compra:
--   situacao  ganha `lida`: as linhas do arquivo, à espera de a pessoa pedir o pedido (vence em 2 h)
--   leitura   { total, semQuantidade }: quantas linhas o arquivo tem, segundo a leitura, e as que vieram sem quantidade
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela está em SO_NUVEM no sync-daemon). Idempotente.
-- A trava da situação é trocada para aceitar o valor novo: o `drop constraint` abaixo não apaga dado.
set local lock_timeout = '5s';

alter table mister_lista_compra add column if not exists leitura jsonb;

alter table mister_lista_compra drop constraint if exists ck_mister_lista_compra_situacao;
alter table mister_lista_compra add constraint ck_mister_lista_compra_situacao
  check (situacao in ('lida', 'montando', 'confirmar', 'criada', 'descartada'));

-- A leitura guardada de uma pessoa.
create index if not exists idx_mister_lista_compra_lida on mister_lista_compra (tenant_id, colaborador_id, criada_em desc) where situacao = 'lida';

comment on column mister_lista_compra.leitura is 'Mister (mig 495): quantas linhas o arquivo tem e as que vieram sem quantidade — só na situação lida';

-- Conferência (no mesmo Run): a coluna, a trava com o valor novo e o índice.
select 'coluna' as o_que, column_name as nome, data_type as detalhe
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'mister_lista_compra' and column_name = 'leitura'
union all
select 'trava', conname, pg_get_constraintdef(oid) from pg_constraint
 where conname = 'ck_mister_lista_compra_situacao'
union all
select 'indice', indexname, null from pg_indexes
 where schemaname = current_schema() and indexname = 'idx_mister_lista_compra_lida'
 order by 1, 2;
