-- 236_whatsapp_template_evento.sql — whatsapp_template ganha EVENTO (gatilho de status)
-- para os modelos de UTILIDADE de acompanhamento de pedido (confirmado, em_preparo,
-- saiu_entrega, entregue, cancelado, atrasado, atendimento). null = modelo que não é de
-- status (marketing). O roteador de avisos ao cliente na API oficial usa isto para achar
-- o template certo quando a janela de 24h está fechada. Aditivo/idempotente.
-- NÃO cloud-only: o whatsapp_template existe no edge (envio de aviso pode partir do PDV).

alter table whatsapp_template add column if not exists evento text;

-- Achar rápido o modelo de um status (por loja). Parcial: só as linhas que têm evento.
create index if not exists idx_whatsapp_template_evento
  on whatsapp_template (tenant_id, evento)
  where evento is not null;
