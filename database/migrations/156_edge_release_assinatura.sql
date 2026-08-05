-- @cloud-only  (altera edge_release, criada pela 124 que é cloud-only → só na nuvem;
-- no edge esta migration é PULADA. Sem o marcador ela abortava as migrations do edge.)
-- 156 — assinatura do release do edge (atualização assinada, Fase 3).
-- Ed25519 de "versao|sha256|url", gerada OFFLINE pela distribuição com a chave
-- privada; o edge verifica com a pública embutida antes de aplicar. Aditiva.
alter table edge_release add column if not exists assinatura text;
