-- 165 — Flag do QR de despacho no delivery (reforma do Painel de controle, Fase 4).
-- Ligado: o cupom do entregador leva um QR; ao ler (/e/{token}), o entregador
-- despacha o pedido sozinho (pronto→despachado, atrelado a ele), sem o atendente
-- avançar manualmente. Desligado (padrão): o AVANÇAR manual abre o modal de
-- seleção de entregador (quando a loja tem entregadores cadastrados).
alter table delivery_config
  add column if not exists qr_despacho boolean not null default false;
