-- @cloud-only
-- 448 — DE ONDE VEM O CUSTO DO GASTO DO WHATSAPP (G3 do protótipo `mockups/regem-whatsapp-gasto.html`; continua a 445).
-- A primeira leitura real (18/11/2026, 05:40) mostrou que a Meta NÃO devolve o custo quando a conta é cobrada por meio de um
-- parceiro: "O CUSTO não é mostrado para empresas que fazem cobranças por meio de um parceiro" (código 10/2388184). A
-- quantidade de mensagens ela devolve. Nesse caso o Regem estima o custo pelo preço publicado da Meta — e a tela, o alerta
-- e o Mister dizem que é estimativa.
--
-- whatsapp_gasto_leitura.fonte_do_custo — 'meta' (o custo que a Meta informou) | 'tabela' (estimado pelo preço publicado,
--   porque a Meta não mostra o custo desta conta). NULL = ainda não leu.
--
-- ⚠️ SÓ NUVEM: `whatsapp_gasto_leitura` já está em SO_NUVEM no sync-daemon (mig 445).
-- Idempotente; nada que apague objeto (LIC-171).
set local lock_timeout = '5s';

alter table whatsapp_gasto_leitura add column if not exists fonte_do_custo text;

-- Conferência (no mesmo Run).
select 'whatsapp_gasto_leitura.fonte_do_custo' as objeto, exists (select 1 from information_schema.columns
  where table_schema = current_schema() and table_name = 'whatsapp_gasto_leitura' and column_name = 'fonte_do_custo') as ok;
