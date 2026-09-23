-- 287 — NFC-e em contingência: a segunda via de papel vira OPÇÃO, e o padrão é NÃO imprimir.
--
-- ⚠️ NÃO é @cloud-only: quem imprime o cupom é o caixa da loja. Aplicar nos dois bancos.
-- ⚠️ Aplicar ANTES do merge. Idempotente (roda de novo sem efeito).
--
-- POR QUE EXISTE
--
-- A mig 286 entregou a contingência imprimindo DUAS vias: a do cliente e a "VIA DO
-- ESTABELECIMENTO", que o MOC 7.0 (Anexo IV, §4) manda guardar até a nota ser transmitida e
-- autorizada. Só que restaurante não guarda cupom em papel — o cupom fiscal que sai do caixa é
-- a via do cliente, e ponto. Imprimir a segunda via em toda venda de contingência é papel que
-- ninguém arquiva e fila de impressão dobrada bem no momento em que a loja está em apuros.
--
-- O próprio manual dá a alternativa, e é a que nós já cumprimos por desenho:
--
--   "Alternativamente à impressão da segunda via do DANFE NFC-e, quando de emissão em
--    contingência, o contribuinte poderá optar pela GUARDA ELETRÔNICA, em local seguro, do
--    respectivo arquivo XML da NFC-e. Neste caso, o contribuinte deverá possibilitar a
--    impressão do respectivo DANFE NFC-e para apresentação ao fisco quando solicitado."
--
-- O XML assinado fica em `nota_fiscal.xml` desde a emissão (antes mesmo da autorização), sobe
-- para a nuvem e volta para a loja — é a guarda de 5 anos que já existe —, e a tela de notas
-- reimprime a DANFE de qualquer uma. Também é o manual que exige o passo que NÃO é de software:
-- para usar a guarda eletrônica, a loja "deverá, previamente, lavrar termo no livro Registro de
-- Utilização de Documentos Fiscais e Termos de Ocorrência - modelo 6, ou formalizar declaração
-- de opção segundo disciplina que vier a ser estabelecida por sua Unidade Federada".
--
-- Por isso: o padrão é NÃO imprimir (a operação real), e quem precisar do papel — porque a UF
-- exige, ou porque o termo ainda não foi lavrado — liga o interruptor.

alter table fiscal_config
  add column if not exists contingencia_via_estabelecimento boolean not null default false;

comment on column fiscal_config.contingencia_via_estabelecimento is
  'true = imprime a 2a via ("VIA DO ESTABELECIMENTO") na contingencia. false (padrao) = guarda '
  'eletronica do XML, conforme MOC 7.0 Anexo IV §4 — exige termo lavrado no livro modelo 6.';
