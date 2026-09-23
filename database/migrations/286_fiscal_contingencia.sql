-- 286 — NFC-e: CONTINGÊNCIA OFF-LINE (tpEmis=9), estado por ponto de emissão.
--
-- ⚠️ NÃO é @cloud-only: quem fica sem SEFAZ é o CAIXA DA LOJA, e é lá que a contingência
--    precisa existir. Aplicar nos dois bancos.
-- ⚠️ Aplicar ANTES do merge. Idempotente (roda de novo sem efeito).
-- Depende de `bump_updated_at` (mig 262), `registrar_exclusao_sync` (262) e
-- `marcar_mudanca_sync` (264) — os gatilhos vão JUNTO, neste arquivo, para não repetir o que
-- aconteceu com a 282/283 (tabela num arquivo e gatilhos em outro).
--
-- POR QUE EXISTE
--
-- Hoje, quando a SEFAZ não responde, a nota fica `pendente` e a venda do caixa para: o cliente
-- está na frente do balcão, com a mercadoria na mão, esperando um cupom que depende da internet.
-- O Ajuste SINIEF 19/16 (cl. 11ª) e o MOC 7.0 (Anexo IV) preveem exatamente isso: a NFC-e é
-- gerada, assinada e IMPRESSA sem autorização prévia (`tpEmis=9`), e transmitida depois — no RJ,
-- **até o fim do primeiro dia útil subsequente** (manual da SEFAZ-RJ de 16/07/2026, pergunta
-- 1.28: *"A decisão da emissão da NFC-e em contingência é exclusiva do contribuinte e não depende
-- de autorização do Fisco"*).
--
-- O estado é POR PONTO DE EMISSÃO (`tenant`, `unidade`, `origem`), a mesma chave de
-- `fiscal_serie`: a loja pode estar sem internet enquanto a nuvem emite normalmente, e cada lado
-- tem a sua série. Um estado só para os dois desligaria a emissão normal de quem está bem.
--
-- O QUE NÃO PODE SER ESQUECIDO (e por isso vira coluna aqui):
--
--  • **Número de contingência NÃO SE INUTILIZA** — Ajuste 19/16, cl. 11ª, §2º, II é literal:
--    *"É vedada: … II - a inutilização de numeração de NFC-e emitida em contingência"*. Ele tem
--    de ser TRANSMITIDO, nem que seja corrigido e reenviado com o mesmo número. Por isso a nota
--    em contingência nunca vira `rejeitada` (que é o status que o relatório de lacunas oferece
--    para inutilizar): ela fica em `contingencia` com o motivo, e `tentativas_transmissao` conta
--    as idas à SEFAZ.
--  • **Não transmitir é multa de 5% do valor da operação** no RJ (art. 62-C, III do RICMS), e
--    transmitir fora do prazo, 100 UFIR-RJ por obrigação. A fila não é detalhe: é o produto.
--  • **Contingência não conserta irregularidade.** No RJ, documento emitido com IE desativada é
--    INIDÔNEO *inclusive em contingência*. Por isso o gatilho é SILÊNCIO da SEFAZ (sem resposta),
--    nunca rejeição — rejeição significa que ela respondeu, e respondeu não.

create table if not exists fiscal_contingencia (
  id                 uuid primary key,
  tenant_id          uuid not null references empresa(id) on delete cascade,
  unidade_id         uuid,
  origem             text not null,           -- 'loja' | 'nuvem' (mesma chave de fiscal_serie)
  ativa              boolean not null default false,
  -- Vai no XML: dhCont (B28) e xJust (B29). Faltando qualquer um, a SEFAZ rejeita com 557.
  dh_cont            timestamptz,
  justificativa      text,
  -- O erro técnico de verdade (timeout, DNS, TLS). NÃO vai no XML — é para o log e o suporte.
  motivo_tecnico     text,
  entrou_em          timestamptz,
  saiu_em            timestamptz,
  -- Última vez que perguntamos à SEFAZ se ela voltou (status do serviço). Evita bater no
  -- webservice a cada venda — o caixa não pode esperar rede para imprimir.
  ultima_verificacao timestamptz,
  notas_emitidas     integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_fiscal_contingencia_origem') then
    alter table fiscal_contingencia
      add constraint ck_fiscal_contingencia_origem check (origem in ('loja','nuvem'));
  end if;
end $$;

-- Uma linha por ponto de emissão. `coalesce` porque `unidade_id` nulo (rede) não se compara
-- em índice único — mesma receita da `uq_fiscal_serie_origem` (mig 278).
create unique index if not exists uq_fiscal_contingencia_ponto
  on fiscal_contingencia (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), origem);

-- ── Quantas vezes já tentamos transmitir esta nota ────────────────────────────────────────
-- A nota de contingência não sai da fila até ser autorizada (não pode ser inutilizada), então
-- é preciso saber quem está emperrada e há quanto tempo, sem ler log.
alter table nota_fiscal add column if not exists tentativas_transmissao integer not null default 0;

-- Fila da contingência: as notas que ainda não foram autorizadas, da mais antiga para a mais
-- nova (é a ordem do prazo).
create index if not exists idx_nota_contingencia
  on nota_fiscal (tenant_id, serie, created_at)
  where status = 'contingencia';

-- ── Sincronismo: carimbo, marcador e exclusão (mesma receita das migs 262/264/272) ────────
-- ⚠️ A TABELA NÃO SOBE nem desce (ela entra em DESCARTAVEL no `sync-daemon.mjs`): o estado é
-- de QUEM está sem SEFAZ. Sincronizar por última-escrita faria a nuvem, que está bem, desligar
-- a contingência da loja que continua sem internet — ou o contrário. Os gatilhos ficam assim
-- mesmo para o carimbo de `updated_at` e para não ser a única tabela fora do padrão.
drop trigger if exists trg_bump_fiscal_contingencia on fiscal_contingencia;
create trigger trg_bump_fiscal_contingencia
  before update on fiscal_contingencia
  for each row execute function bump_updated_at();
