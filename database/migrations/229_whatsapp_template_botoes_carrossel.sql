-- @cloud-only — templates da API oficial vivem só na nuvem.
--
-- 229_whatsapp_template_botoes_carrossel.sql — botões (URL "Peça agora" / copiar cupom /
-- quick-reply / sair-do-marketing) e CARROSSEL (2–10 cards com imagem) nos templates da
-- Cloud API. Só faz sentido no provedor 'cloud'. Aditivo/idempotente.

alter table whatsapp_template add column if not exists botoes jsonb;
  -- template simples: [{tipo:'url'|'copy_code'|'quick_reply'|'optout', texto, url?}]
alter table whatsapp_template add column if not exists formato text not null default 'padrao';
  -- 'padrao' | 'carrossel'
alter table whatsapp_template add column if not exists cards jsonb;
  -- carrossel: [{imagemRef, corpo, botoes:[{tipo,texto,url?}]}] (2–10 cards, só imagem por ora)
