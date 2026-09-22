-- 280_fiscal_url_consulta_chave.sql — a URL de "consulta pela chave de acesso" da UF passa a
-- ter lugar próprio na configuração fiscal.
--
-- ⚠️ NÃO é @cloud-only: `fiscal_config` existe nos dois bancos e desce para a loja (mig 278).
-- ⚠️ Aplicar ANTES do merge. Idempotente. Só adiciona colunas.
--
-- POR QUÊ
-- A NFC-e leva, no grupo <infNFeSupl>, DUAS URLs da SEFAZ da UF: a do QR Code (<qrCode>) e a
-- de consulta pela chave de acesso (<urlChave>). São endereços DIFERENTES — na nota real da
-- loja-piloto (RJ) a consulta por chave é www.fazenda.rj.gov.br/nfce/consulta, e o QR aponta
-- para outro host. O código reaproveitava a URL do QR no lugar da de consulta, e nem chegava a
-- escrever o grupo no XML. Como a do QR (mig 278), ela varia por UF e por ambiente, e é
-- preenchida pela DISTRIBUIÇÃO, não pelo lojista.

alter table fiscal_config add column if not exists url_chave_prod    text;
alter table fiscal_config add column if not exists url_chave_homolog text;
