-- 255_estoque_snapshot_por_loja.sql — O snapshot diário de estoque passa a ser por LOJA.
--
-- ⚠️ NÃO é @cloud-only: o job de snapshot roda na nuvem e no edge.
-- ⚠️ Aplicar ANTES do merge, e a 256 LOGO EM SEGUIDA, também antes do merge (ver abaixo).
--
-- POR QUÊ — estoque por loja, fase B1 (separação total por loja, decisão do dono)
-- O snapshot guardava UM saldo por (empresa, insumo, dia), somando todos os movimentos do
-- insumo. Com o mesmo insumo em duas lojas, o estoque inicial e final do CMV de cada loja
-- era o das duas juntas. Desde a mig 253 cada movimento tem loja; o snapshot passa a ser
-- por (empresa, LOJA, insumo, dia).
--
-- A CHAVE
-- Era a primary key (tenant_id, item_id, data). Passa a ser um índice único que inclui a
-- loja. `coalesce` com o UUID nulo trata "sem loja" como uma chave própria (empresa sem
-- nenhuma loja cadastrada) em vez de deixar dois nulos passarem como diferentes — e, ao
-- contrário de `nulls not distinct`, funciona em qualquer versão do Postgres: o servidor
-- local pode rodar um Postgres já instalado no PC, não só o 17 embutido.
--
-- A troca é segura para os dados existentes: a chave nova só GANHOU uma coluna, então
-- toda linha válida hoje continua válida.
--
-- POR QUE A 256 PRECISA VIR JUNTO
-- As linhas antigas têm a loja do INSUMO (nula para insumo compartilhado). As novas, a loja
-- do MOVIMENTO. Para a mesma data ficariam lado a lado — uma nula, outra com loja — e o CMV
-- somaria as duas: estoque DOBRADO. A 256 reconstrói as antigas por loja.

alter table estoque_snapshot drop constraint if exists estoque_snapshot_pkey;

create unique index if not exists idx_estoque_snapshot_chave
  on estoque_snapshot (
    tenant_id,
    coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid),
    item_id,
    data
  );
