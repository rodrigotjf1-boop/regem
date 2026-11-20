-- @cloud-only
-- 468 — MISTER: por que o WhatsApp de alguém foi desligado (versão 6, fase M6a; plano aprovado em 20/11/2026,
-- `docs/plano-mister.md` § "Versão 6"; protótipo `mockups/regem-mister-v6.html`, aba "Segurança").
--
-- Até aqui, desligar o WhatsApp do Mister só apagava o telefone do vínculo: ninguém sabia depois POR QUE ele saiu. A v6
-- precisa saber, em dois lugares:
--   • mister_vinculo (a pessoa): a parte "Pessoas" mostra "desligado em 02/11 · 60 dias sem conversa";
--   • mister_conversa (o telefone): quem escreve depois de desligado recebe a frase do motivo ("…por ficar 60 dias sem
--     conversa…"), e não a de quem nunca ligou.
-- Os motivos: pessoa (desligou o próprio), presidente (desligou o de outra pessoa), vencido (60 dias sem conversa), dms
-- (o suporte da DMS, pelo console, com o motivo na auditoria) e nao_reconheco (o presidente tocou "Não reconheço" no aviso
-- de telefone ligado). Ligar de novo limpa os dois.
--
-- ⚠️ SÓ NUVEM (as tabelas do Mister são da 417, `@cloud-only`). Idempotente; nada que apague objeto (LIC-171): as travas
-- entram só se ainda não existem.
set local lock_timeout = '5s';

alter table mister_vinculo add column if not exists desligado_em timestamptz;
alter table mister_vinculo add column if not exists desligado_motivo text;
alter table mister_conversa add column if not exists desligado_em timestamptz;
alter table mister_conversa add column if not exists desligado_motivo text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_mister_vinculo_desligado_motivo') then
    alter table mister_vinculo add constraint ck_mister_vinculo_desligado_motivo
      check (desligado_motivo is null or desligado_motivo in ('pessoa', 'presidente', 'vencido', 'dms', 'nao_reconheco'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_mister_conversa_desligado_motivo') then
    alter table mister_conversa add constraint ck_mister_conversa_desligado_motivo
      check (desligado_motivo is null or desligado_motivo in ('pessoa', 'presidente', 'vencido', 'dms', 'nao_reconheco'));
  end if;
end $$;

-- A volta diária do vencimento procura os ligados pela última conversa (a tabela é pequena, mas a leitura não varre tudo).
create index if not exists idx_mister_vinculo_ligado_conversa on mister_vinculo (greatest(ligado_em, coalesce(ultima_entrada_em, ligado_em)))
  where ligado_em is not null and telefone is not null;

-- Conferência (no mesmo Run): as quatro colunas, as duas travas e o índice.
select 'coluna' as o_que, table_name || '.' || column_name as nome
  from information_schema.columns
 where table_schema = current_schema() and table_name in ('mister_vinculo', 'mister_conversa') and column_name in ('desligado_em', 'desligado_motivo')
union all
select 'trava', conname from pg_constraint where conname in ('ck_mister_vinculo_desligado_motivo', 'ck_mister_conversa_desligado_motivo')
union all
select 'indice', indexname from pg_indexes where schemaname = current_schema() and indexname = 'idx_mister_vinculo_ligado_conversa'
 order by 1, 2;
