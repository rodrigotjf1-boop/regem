-- @cloud-only — templates da API oficial vivem só na nuvem (o edge não fala com a Meta).
--
-- 240_whatsapp_template_lto_cabecalho_var.sql — duas frentes da Fase 2 do editor de modelos:
--
-- 1) OFERTA POR TEMPO LIMITADO (LTO / limited_time_offer da Meta). O modelo guarda a
--    DURAÇÃO ("válido por N horas"), não uma data fixa: a Meta quer o INSTANTE de expiração
--    (expiration_time_ms, epoch em ms) no ENVIO, então calculamos `agora + N horas` na hora
--    de disparar. Assim o mesmo modelo aprovado serve para qualquer campanha, sem precisar
--    reaprovar quando a data muda (data fixa queimaria o modelo depois de vencer).
--    lto_horas nulo = usa o padrão do código (3 horas).
--    Regras da Meta que o backend passa a travar: categoria MARKETING, cabeçalho só de
--    IMAGEM/VÍDEO, RODAPÉ proibido e carrossel não suportado.
--
-- 2) CABEÇALHO DE TEXTO COM VARIÁVEL ({{1}}). A Meta exige o `example.header_text` na
--    criação — e ali é um array SIMPLES (diferente do corpo, que é aninhado); sem ele o
--    modelo é recusado. cabecalho_exemplo guarda esse valor de exemplo.
--
-- Aditivo e idempotente.

alter table whatsapp_template add column if not exists lto_ativo boolean not null default false;
alter table whatsapp_template add column if not exists lto_texto text;
alter table whatsapp_template add column if not exists lto_horas integer;
alter table whatsapp_template add column if not exists cabecalho_exemplo text;
