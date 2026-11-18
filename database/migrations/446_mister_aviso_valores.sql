-- @cloud-only
-- 446 — OS VALORES DO ALERTA DE GASTO (G2 do protótipo `mockups/regem-whatsapp-gasto.html`, aprovado pelo dono em
-- 18/11/2026: "alertas pelo Mister", "com opção de mais de um alerta [valor 1 - alerta 1, valor 2 novo alerta, …]").
--
-- mister_aviso_regra.valores — os valores do aviso "Gasto do WhatsApp oficial" (até 10, em reais, em ordem): cada um avisa
--   uma vez por mês, quando o gasto do mês na Meta (mig 445) passa dele. NULL nos outros tipos de aviso.
--
-- ⚠️ SÓ NUVEM: `mister_aviso_regra` já está em SO_NUVEM no sync-daemon (mig 419).
-- Idempotente; nada que apague objeto (LIC-171).
set local lock_timeout = '5s';

alter table mister_aviso_regra add column if not exists valores numeric(12,2)[];

-- Conferência (no mesmo Run).
select 'mister_aviso_regra.valores' as objeto, exists (select 1 from information_schema.columns
  where table_schema = current_schema() and table_name = 'mister_aviso_regra' and column_name = 'valores' and data_type = 'ARRAY') as ok;
