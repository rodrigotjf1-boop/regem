-- 151 — Tipo de consumo na comanda de venda externa/totem (L-VEN-1).
-- 'local' (comer aqui) | 'viagem'. Enviado pelo GoGeM em /vendas/externa-pdv.
-- Nulo em vendas de balcão (não informado). Afeta cozinha/embalagem.
ALTER TABLE comanda ADD COLUMN IF NOT EXISTS consumo TEXT;
