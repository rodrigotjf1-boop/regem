-- 129_kds_impressao_por_etapa.sql — impressão GUIADA POR ETAPA do KDS.
-- Em vez de imprimir no momento do pedido (PDV), o ticket fica "contido": aparece
-- no KDS de produção, é avançado, chega ao KDS de despacho e SÓ ENTÃO imprime, na
-- impressora definida na configuração DAQUELE KDS.
-- Config fica no equipamento tipo 'kds'. Idempotente.

-- Este KDS dispara impressão quando o pedido AVANÇA para `imprime_no_status`.
alter table equipamento add column if not exists imprime_ao_avancar boolean not null default false;
-- Etapa que dispara (padrão 'pronto'): recebido | preparo | pronto | entregue.
alter table equipamento add column if not exists imprime_no_status text not null default 'pronto';
-- Impressora que recebe o ticket quando a etapa dispara (null = usa a padrão do setor).
alter table equipamento add column if not exists impressora_destino_id uuid;
