-- 239_whatsapp_template_cabecalho_midia.sql — modelo simples pode ter CABEÇALHO DE MÍDIA
-- (imagem/vídeo/documento), não só texto. cabecalho_formato = null/text|image|video|document;
-- cabecalho_midia_ref = URL da mídia. Aditivo/idempotente. NÃO cloud-only (whatsapp_template
-- existe no edge).

alter table whatsapp_template add column if not exists cabecalho_formato text;
alter table whatsapp_template add column if not exists cabecalho_midia_ref text;
