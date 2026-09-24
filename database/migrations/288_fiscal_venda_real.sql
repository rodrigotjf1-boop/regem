-- 288 — NFC-e pronta para a VENDA REAL: informação ao Fisco, terminal fiscal e taxa de serviço.
--
-- ⚠️ NÃO é @cloud-only: a loja emite as próprias notas. Aplicar nos dois bancos.
-- ⚠️ Aplicar ANTES do merge. Idempotente (roda de novo sem efeito).
--
-- POR QUE EXISTE
--
-- Toda a homologação até aqui foi uma nota de TESTE paga em dinheiro. A venda real de
-- restaurante traz três coisas que o documento ainda não sabia dizer, e cada uma é uma escolha
-- de quem opera — não uma constante do código.
--
-- 1) INFORMAÇÃO AO FISCO (`infAdFisco`). No RJ, pela Lei 8.405/19 (manual da SEFAZ-RJ,
--    pergunta 1.49), havendo percentual e valor do FECP, os dois vão nesse campo — e "em caso
--    de NÃO INCIDÊNCIA do FECP, deverá constar essa informação". O campo nunca fica vazio. Se o
--    FECP incide ou não nos produtos da loja é fato tributário DELA, que o contador confirma:
--    por isso o texto é configuração, e a emissão em PRODUÇÃO no RJ recusa enquanto estiver
--    vazio. Dado incorreto na NFC-e é multa de 3% do valor da operação (RICMS, art. 62-C, XI).
--
-- 2) TERMINAL FISCAL. Cada terminal (PDV ou totem) pode ou não emitir NFC-e — é assim que a
--    operação real funciona durante uma transição de sistema (hoje, na loja-piloto, o servidor e
--    o totem emitem pela Eclética e dois PDVs não). NULO = segue a configuração da loja; FALSE =
--    este terminal não emite. Quem muda é PRESIDENTE ou GERENTE, e cada mudança é auditada.
--
-- 3) TAXA DE SERVIÇO (garçom). A CLT (art. 457, §6º) manda lançá-la "na respectiva nota de
--    consumo" e diz que ela NÃO é receita da casa (§4º). No regime normal, o Convênio ICMS 125/11
--    autoriza tirá-la da base do ICMS (10%; 15% em SP desde 19/02/2026) — no RJ ela entra como
--    ITEM com CST 41. No Simples essa exclusão NÃO vale: "as gorjetas, sejam elas compulsórias
--    ou não, integram a receita bruta" (Res. CGSN 140/18, art. 2º, §4º, II). Cada casa tem o seu
--    protocolo, e a codificação no Simples é decisão do contador — por isso NULO significa "ainda
--    não escolhido", e a emissão de comanda COM taxa recusa até a loja escolher.

alter table fiscal_config add column if not exists info_fisco text;
comment on column fiscal_config.info_fisco is
  'Texto do infAdFisco. RJ: FECP (Lei 8.405/19) — obrigatório, inclusive para declarar a NAO '
  'incidência. Confirmado pelo contador da loja.';

alter table equipamento add column if not exists emite_nfce boolean;
comment on column equipamento.emite_nfce is
  'NULO = segue fiscal_config.ativo da loja; FALSE = este terminal NAO emite NFC-e. '
  'Alterado só por presidente/gerente, com auditoria.';

alter table fiscal_config add column if not exists taxa_servico_nfce text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_fiscal_taxa_servico_nfce') then
    alter table fiscal_config
      add constraint ck_fiscal_taxa_servico_nfce
      check (taxa_servico_nfce is null
             or taxa_servico_nfce in ('item_nao_tributado', 'item_tributado', 'fora_da_nota'));
  end if;
end $$;

comment on column fiscal_config.taxa_servico_nfce is
  'Como a taxa de serviço entra na NFC-e. item_nao_tributado = linha com CST 41 (regime normal, '
  'Conv. ICMS 125/11); item_tributado = linha tributada (Simples: integra a receita bruta, '
  'CGSN 140/18); fora_da_nota = não entra no documento fiscal. NULO = não escolhido.';
