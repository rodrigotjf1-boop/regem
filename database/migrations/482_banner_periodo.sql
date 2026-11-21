-- 482 · BANNER — O PERÍODO EM QUE APARECE (fase B3 do `docs/plano-clube-e-banner.md`; protótipo
-- `mockups/regem-clube-banner.html`, aprovado pelo dono em 20/11/2026, gaveta "Ao tocar no banner, abre").
--
-- O que entra:
--   banner.aparece_de / banner.aparece_ate — o período opcional do banner no cardápio online (dias da operação; vazio =
--     sem limite daquele lado). O cardápio público só mostra o banner dentro do período.
--
-- A `banner` já existe na nuvem e na loja (desce pelo sync): as colunas entram nas duas; o sync da loja só copia as
-- colunas que a loja tem (`colunas()` do sync-daemon), então a loja que ainda não recebeu esta migration segue igual.
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Colunas novas e nulas: nenhuma linha muda.
set local lock_timeout = '5s';

alter table banner add column if not exists aparece_de date;
alter table banner add column if not exists aparece_ate date;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'coluna banner.aparece_de' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'banner' and column_name = 'aparece_de') as ok
union all
select 'coluna banner.aparece_ate',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'banner' and column_name = 'aparece_ate');
