-- @cloud-only
-- 451 — O MOTIVO DE NÃO LER O GASTO POR MODELO (continua a 445 e a 448; G3b do protótipo `mockups/regem-whatsapp-gasto.html`).
-- Em produção (18/11/2026), a conta principal da Mister Burger leu o preço e o volume, mas o gasto por modelo
-- (`template_analytics`) falhou a cada leitura — e o motivo ia só para o log da API: a tela mostrava o "De onde veio" sem
-- os modelos, como se não houvesse modelo enviado (V37: a tela separa "vazio" de "não li").
--
-- whatsapp_gasto_leitura.modelos_erro — o motivo da última tentativa de ler os modelos que falhou; NULL = leu (ou ainda
--   não tentou). A tela mostra o motivo no "De onde veio".
--
-- ⚠️ SÓ NUVEM: `whatsapp_gasto_leitura` já está em SO_NUVEM no sync-daemon (mig 445).
-- Idempotente; nada que apague objeto (LIC-171).
set local lock_timeout = '5s';

alter table whatsapp_gasto_leitura add column if not exists modelos_erro text;

-- Conferência (no mesmo Run).
select 'whatsapp_gasto_leitura.modelos_erro' as objeto, exists (select 1 from information_schema.columns
  where table_schema = current_schema() and table_name = 'whatsapp_gasto_leitura' and column_name = 'modelos_erro') as ok;
