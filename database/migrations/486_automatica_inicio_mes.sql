-- @cloud-only
-- 486 · "INÍCIO DO MÊS" (F7 parte 4c do `docs/plano-perfil-cliente.md`, §6.3 — aprovada pelo dono em 19/11/2026; protótipo
-- `mockups/regem-perfil-cliente.html`, aba "Marketing", "Automáticas novas": "Início do mês — do 1º ao 5º dia útil, para
-- quem pede mais nessa época. Desligada"). Só NUVEM (`relacionamento_*` é SO_NUVEM no sync-daemon).
--
-- relacionamento_config.inicio_mes_ativo — ligado (Delivery › Marketing › Automáticas), do dia 1 ao 5º dia útil sai UMA
--   mensagem no mês para quem tem o selo "dinheiro no bolso" e o aceite de ofertas CLICADO (D4/D15), se ainda não pediu no
--   mês. Nasce DESLIGADO.
-- ck_rel_envio_tipo — ganha o tipo `inicio_mes`. A trava nova CONTÉM a antiga: toda linha que já existe continua valendo.
--
-- ⚠️ Troca a restrição (`drop constraint if exists` + `add constraint`): vai pelo SQL EDITOR do Supabase, não pelo MCP (que
--    recusa instrução com `drop` — LIC-171, ERR-225). Aplicar na NUVEM ANTES do merge. É uma transação só no SQL Editor; o
--    `lock_timeout` faz a migration desistir sem mudar nada se a tabela estiver presa. Idempotente.
-- ⚠️ A guarda exige uma tabela só do Regem antes de qualquer `alter` (colada no projeto errado, para aqui).
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.relacionamento_envio') is null
     or to_regclass(current_schema() || '.relacionamento_config') is null
     or to_regclass(current_schema() || '.cliente_evento_sensibilidade') is null then
    raise exception 'A 486 é do Regem e depende da 356 (automáticas) e da 463 (o que move o cliente): confira o projeto no topo do Supabase.';
  end if;
end $$;

alter table relacionamento_config add column if not exists inicio_mes_ativo boolean not null default false;

alter table relacionamento_envio drop constraint if exists ck_rel_envio_tipo;
alter table relacionamento_envio add constraint ck_rel_envio_tipo
  check (tipo in ('cashback', 'aniversario', 'volta', 'inicio_mes'));

-- Conferência (no mesmo Run).
select (select count(*) from information_schema.columns where table_schema = current_schema()
          and table_name = 'relacionamento_config' and column_name = 'inicio_mes_ativo') = 1
   and exists (select 1 from pg_constraint where conrelid = (current_schema() || '.relacionamento_envio')::regclass
                 and conname = 'ck_rel_envio_tipo' and pg_get_constraintdef(oid) like '%inicio_mes%') as ok;
