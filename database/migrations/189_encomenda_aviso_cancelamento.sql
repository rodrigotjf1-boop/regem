-- 189_encomenda_aviso_cancelamento.sql
-- S4: idempotência do lembrete de prazo de cancelamento da encomenda com sinal.
-- Marca quando o lembrete já foi enviado (via webhook n8n) para não repetir a cada
-- rodada do cron.
alter table pedido_externo
  add column if not exists avisado_cancelamento_em timestamptz;
