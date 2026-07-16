-- 100 — Terminal de PDV F3: impressora (cupom) amarrada ao terminal.
-- A via do cliente sai só na impressora deste terminal → fallback cupom da unidade.
-- Impressoras de setor (produção, TCP 9100) seguem inalteradas (roteadas por setor).

alter table equipamento add column if not exists impressora_padrao_id uuid;
