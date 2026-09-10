-- 234_whatsapp_retencao.sql — retenção do histórico de conversas do WhatsApp (lado Cloud,
-- tabela whatsapp_mensagem). Configurável por loja: null/0 = manter tudo; N = manter só os
-- últimos N dias (um job periódico apaga whatsapp_mensagem com criado_em < now() - N dias).
-- Aditivo/idempotente.

alter table cardapio_config add column if not exists wa_retencao_dias integer;
  -- dias de retenção do histórico Cloud (null/0 = ilimitado; 1 = só hoje/24h; 7 = semana; 30 = mês; N = custom)
