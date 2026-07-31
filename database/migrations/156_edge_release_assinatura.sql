-- 156 — assinatura do release do edge (atualização assinada, Fase 3).
-- Ed25519 de "versao|sha256|url", gerada OFFLINE pela distribuição com a chave
-- privada; o edge verifica com a pública embutida antes de aplicar. Aditiva.
alter table edge_release add column if not exists assinatura text;
