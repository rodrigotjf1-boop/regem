-- 487 · BANNER — A VERSÃO ANIMADA (GIF) DA IMAGEM (fase B3 do `docs/plano-clube-e-banner.md`, decisão D8; protótipo
-- `mockups/regem-clube-banner.html`, aprovado pelo dono em 20/11/2026).
--
-- O que entra:
--   banner.imagem_animada_ref — o GIF feito a partir da imagem do banner, pelo DMS Graph, sem IA e sem franquia. A
--     `imagem_ref` continua sendo a imagem parada: é o que vê quem pediu menos movimento no aparelho.
--
-- A `banner` já existe na nuvem e na loja (desce pelo sync): a coluna entra nas duas; o sync da loja só copia as colunas
-- que a loja tem (`colunas()` do sync-daemon), então a loja que ainda não recebeu esta migration segue com a imagem parada.
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Nenhuma linha muda de sentido.
set local lock_timeout = '5s';

alter table banner add column if not exists imagem_animada_ref text;

-- Conferência no MESMO Run: a linha tem de vir com `ok = true`.
select 'coluna banner.imagem_animada_ref' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'banner' and column_name = 'imagem_animada_ref') as ok;
