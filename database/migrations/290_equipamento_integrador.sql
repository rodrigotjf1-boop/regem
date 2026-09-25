-- 290 — Qual equipamento é a credencial do GoGeM (ERR-108).
--
-- O GoGeM aceita UM token por empresa: o da integração dele, que é o token de um equipamento
-- `servidor_local` cadastrado no Regem. Com vários `servidor_local` na empresa (servidores de loja,
-- sobras de instalação), o Regem pegava "um qualquer" (`limit(1)` sem ordem) para avisar o GoGeM do
-- cancelamento — e 5 de 6 davam 401: o estorno do cartão/PIX não era pedido. A instalação reusava
-- "o primeiro" e religava todos; a re-autorização girava o mais recente, que podia ser o do GoGeM.
--
-- Agora o equipamento do GoGeM fica MARCADO. Toda chamada do GoGeM à nuvem vem com
-- `X-Integrador: gogem` junto do token (GoGeM #137), e é ela que marca — só na nuvem, só um
-- `servidor_local` que nunca sincronizou (servidor de loja não vira credencial de integração), e só
-- grava quando muda ou de hora em hora (`integrador_visto_em`).
--
-- NÃO é só-nuvem: o `equipamento` existe no servidor da loja, e a autenticação por token de
-- dispositivo lê todas as colunas dele. Lá as colunas ficam vazias (o servidor_local nunca desce).
-- ⚠️ Aplicar na NUVEM ANTES do merge: sem as colunas, toda autenticação por token de dispositivo cai.
alter table equipamento add column if not exists integrador text;
alter table equipamento add column if not exists integrador_visto_em timestamptz;

create index if not exists idx_equipamento_integrador
  on equipamento (tenant_id, integrador) where integrador is not null;
