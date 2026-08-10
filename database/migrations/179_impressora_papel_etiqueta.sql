-- 179_impressora_papel_etiqueta.sql — 3º papel da impressora: ETIQUETA (validade).
-- Antes só havia faz_cupom (Caixa) e faz_producao (Cozinha, mig 167). A etiqueta de
-- validade (RDC 216) caía na 1ª impressora ativa qualquer — normalmente a de cupom.
-- Agora a loja designa uma impressora de etiqueta e o roteamento manda só pra ela.
--
-- NÃO é @cloud-only: `equipamento` existe no edge e o backend do edge lê este flag.
alter table equipamento add column if not exists faz_etiqueta boolean not null default false;
