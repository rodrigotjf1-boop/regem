-- @cloud-only
-- 479 · CLUBE — DESDE QUANDO O ÁLBUM E A META ESTÃO LIGADOS (fases A2 e A3 do `docs/plano-clube-e-banner.md`; protótipo
-- `mockups/regem-clube-banner.html`, aprovado pelo dono em 20/11/2026). Só NUVEM, como a 471.
--
-- O que entra:
--   clube_config.album_desde — quando o álbum de selos foi ligado: só os pedidos concluídos DEPOIS dão selo (ligar não
--     premia o passado; desligar zera, e ligar de novo começa outra vez). Nulo = desligado.
--   clube_config.meta_desde — o mesmo para a meta do mês (A3).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Colunas novas e nulas: nenhuma linha muda.
set local lock_timeout = '5s';

alter table clube_config add column if not exists album_desde timestamptz;
alter table clube_config add column if not exists meta_desde timestamptz;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'coluna clube_config.album_desde' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'clube_config' and column_name = 'album_desde') as ok
union all
select 'coluna clube_config.meta_desde',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'clube_config' and column_name = 'meta_desde');
