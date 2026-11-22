-- @cloud-only
-- 491 — MISTER: o padrão do descarte (versão 7, etapa V7e; protótipo `mockups/regem-mister-v7.html`, "O padrão que ele percebe
-- sozinho"). `mister_padrao.tipo` ganha `descarte_no_dia_da_semana`: o mesmo item descartado no mesmo dia da semana em 3 ou mais
-- das últimas 5 semanas. Avisa uma vez; "Deixa assim" cala por 30 dias (o mecanismo da 478).
--
-- ⚠️ SÓ NUVEM: a tabela é SO_NUVEM no sync-daemon e o servidor da loja pula o arquivo.
-- ⚠️ TEM `drop constraint` (uma restrição de CHECK só se alarga trocando-a, na MESMA instrução): vai pelo SQL EDITOR do Supabase,
-- não pelo MCP, que devolve "declined" sem mostrar a confirmação (LIC-171). Idempotente; não apaga dado.
-- Enquanto ela não entra, o Mister não procura esse padrão (`MisterPadroesService.aceitaODescarte`) e os outros seguem normais.
set local lock_timeout = '5s';

alter table mister_padrao
  drop constraint if exists ck_mister_padrao_tipo,
  add constraint ck_mister_padrao_tipo
    check (tipo in ('impressora_antes_do_fechamento', 'avisos_sem_resposta', 'atrasos_na_faixa', 'descarte_no_dia_da_semana'));

-- Conferência (no mesmo Run): a restrição com o tipo novo.
select conname as nome, pg_get_constraintdef(oid) as detalhe
  from pg_constraint
 where conname = 'ck_mister_padrao_tipo' and conrelid = 'mister_padrao'::regclass;
