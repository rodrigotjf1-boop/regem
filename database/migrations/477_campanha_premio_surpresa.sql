-- @cloud-only
-- 477 · CLUBE — A CAMPANHA COM PRÊMIO SURPRESA (fase A1d / G4 do `docs/plano-clube-e-banner.md`; protótipo
-- `mockups/regem-clube-banner.html`, aprovado pelo dono em 20/11/2026). Só NUVEM, como a `campanha` (195): o edge não
-- dispara campanhas.
--
-- O que entra:
--   campanha.clube_premio_id — o prêmio do Clube que cada destinatário ganha (nulo = campanha sem prêmio, como sempre).
--     Na hora de mandar a cada um, o disparo cria o direito do Clube (gatilho "campanha", a referência = o envio) com o
--     cupom pessoal, e o link rastreado da campanha (`/publico/campanha/r/<envio>`) leva ao link pessoal do prêmio
--     (`/p/<código>`), onde o cliente raspa ou gira. Todos os destinatários ganham — nada de sorteio.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Coluna nova e nula: nenhuma linha muda.
set local lock_timeout = '5s';

alter table campanha add column if not exists clube_premio_id uuid;

-- Conferência no MESMO Run: a linha tem de vir com `ok = true`.
select 'coluna campanha.clube_premio_id' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'campanha' and column_name = 'clube_premio_id') as ok;
