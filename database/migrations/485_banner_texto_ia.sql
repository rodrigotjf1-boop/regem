-- 485 · BANNER — O TEXTO POR CIMA E A MARCA "FEITO COM IA" (fase B2 do `docs/plano-clube-e-banner.md`; protótipo
-- `mockups/regem-clube-banner.html`, aprovado pelo dono em 20/11/2026, gaveta "Criar banner com IA").
--
-- O que entra:
--   banner.texto_titulo / banner.texto_chamada — o texto que o Regem escreve POR CIMA da imagem (D7): sem erro de
--     português, e dá para mudar depois sem gerar a imagem de novo.
--   banner.descricao — o texto para leitor de tela.
--   banner.feito_com_ia — a imagem veio do DMS Graph.
--
-- A `banner` já existe na nuvem e na loja (desce pelo sync): as colunas entram nas duas; o sync da loja só copia as
-- colunas que a loja tem (`colunas()` do sync-daemon), então a loja que ainda não recebeu esta migration segue igual.
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Nenhuma linha muda de sentido.
set local lock_timeout = '5s';

alter table banner add column if not exists texto_titulo text;
alter table banner add column if not exists texto_chamada text;
alter table banner add column if not exists descricao text;
alter table banner add column if not exists feito_com_ia boolean not null default false;

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`.
select 'coluna banner.' || c as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'banner' and column_name = c) as ok
  from unnest(array['texto_titulo', 'texto_chamada', 'descricao', 'feito_com_ia']) as c;
