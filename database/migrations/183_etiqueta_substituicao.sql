-- 183_etiqueta_substituicao.sql — "anular e sobrepor": ao ABRIR e a validade encurtar,
-- a etiqueta antiga é ANULADA (status 'substituida') e uma NOVA (novo QR) a sobrepõe.
-- Aqui só o link p/ a nova; o status 'substituida' é um valor de texto (sem migração).
--
-- NÃO é @cloud-only: etiqueta_validade existe no edge.
alter table etiqueta_validade add column if not exists substituida_por_id uuid;
