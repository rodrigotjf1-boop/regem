-- 238_cardapio_config_msg_limit.sql — cache do LIMITE de envio do WhatsApp (conversas
-- iniciadas / 24h). Atualizado pelo webhook business_capability_update da Meta quando o
-- tier muda (250 → 1K → …), para o Regem mostrar sem depender de chamada ao vivo.
-- Aditivo/idempotente. NÃO cloud-only (cardapio_config existe no edge; colunas nullable).

alter table cardapio_config add column if not exists wa_msg_limit integer;
alter table cardapio_config add column if not exists wa_msg_limit_em timestamptz;
