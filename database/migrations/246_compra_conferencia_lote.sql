-- 246_compra_conferencia_lote.sql — CONFERÊNCIA na lista de compras + identidade do LOTE.
--
-- ⚠️ NÃO é @cloud-only: `compra_*`, `lote` e `etiqueta_validade` existem no edge
-- (ComprasModule e EtiquetaValidadeModule são EDGE_CORE) e é lá que a compra é
-- conferida. Aplicar na nuvem E no edge.
--
-- POR QUÊ
-- Levantamento na base real: `recebimento` = 0 notas, `lote` = 0 linhas. O PVPS/FEFO
-- nunca rodou UMA vez desde a mig 012 — e não por desuso da funcionalidade. `lote` só
-- nasce em `recebimento.confirmar()`, e o estoque entra de verdade por
-- `compras.receber()`, que nunca chamou aquele código. O épico inteiro estava
-- pendurado numa porta que ninguém abre.
--
-- 1) CONFERÊNCIA (compra_item)
-- `compras.receber()` lança no estoque a quantidade PEDIDA. Pediu 10 caixas, chegaram
-- 7, entram 10 — estoque que não existe, e o custo médio ponderado calculado sobre ele.
-- Não havia `qtd_recebida` nem divergência: isso só existe em `recebimento_item`, do
-- fluxo morto. A conferência é também o momento em que a validade é conhecida (está
-- impressa na embalagem que a pessoa tem na mão) — não no cadastro do insumo, porque
-- cada compra do mesmo insumo chega com uma validade diferente.
--
-- `validade_indefinida` é um valor EXPLÍCITO, não a ausência de data. A validade passa a
-- ser obrigatória na conferência, e o descartável (guardanapo, saco de lixo) é declarado
-- como indefinido em vez de deixado em branco: campo em branco é o estado de hoje, em
-- que ninguém preenche e a funcionalidade inteira morre calada. Três estados:
--   validade preenchida        → lote com validade, entra nos alertas;
--   validade_indefinida = true → lote sem validade, fora dos alertas, decisão registrada;
--   nenhum dos dois            → a conferência é RECUSADA.
--
-- 2) IDENTIDADE DO LOTE
-- `lote` não tinha código nem fornecedor — era só "a entrada daquela nota". Sem o código
-- do fabricante não dá para separar mercadoria numa troca ou num recall sem abrir
-- embalagem, que é a razão de existir do lote. E o mesmo insumo vindo de fornecedores
-- diferentes ficava indistinguível.
--
-- 3) ELO ETIQUETA → LOTE
-- A etiqueta é impressa por uma PESSOA, na quantidade que ela decide (2000 ml de molho
-- viram 4 potes ou 10; 7 caixas levam 7 etiquetas ou 84) — nunca gerada em massa a
-- partir do documento. Com `lote_id`, a etiqueta impressa a partir de um lote herda
-- validade e fornecedor já preenchidos, e o recall alcança inclusive o que já foi
-- ABERTO — hoje, impossível.

-- ===== 1. Conferência na linha da compra =====
alter table compra_item add column if not exists qtd_recebida numeric;               -- null = ainda não conferida
alter table compra_item add column if not exists validade date;
alter table compra_item add column if not exists validade_indefinida boolean not null default false;
alter table compra_item add column if not exists lote_codigo text;
-- Mesmo vocabulário de `recebimento_item.divergencia` — não criar um segundo dicionário
-- para a mesma ideia: ok | parcial | nao_veio | danificado | excedente.
alter table compra_item add column if not exists divergencia text not null default 'ok';

-- ===== 2. Identidade e escopo do lote =====
alter table lote add column if not exists codigo text;                -- código do lote do fabricante
alter table lote add column if not exists fornecedor_id uuid;
alter table lote add column if not exists unidade_id uuid;            -- a loja onde a mercadoria está
alter table lote add column if not exists compra_item_id uuid;        -- origem (havia só recebimento_id)
alter table lote add column if not exists validade_indefinida boolean not null default false;

-- ===== 3. Etiqueta impressa a partir de um lote =====
alter table etiqueta_validade add column if not exists lote_id uuid;

-- ===== 4. Índices =====
-- ⚠️ Lição da mig 244: o arquivo roda como UMA transação — um índice que estoura o
-- statement_timeout desfaz TODOS os ALTERs acima e a migration "passa" calada. As três
-- tabelas são pequenas (`lote` tem 0 linhas hoje), então é seguro.
create index if not exists idx_lote_codigo      on lote (tenant_id, codigo) where codigo is not null;
create index if not exists idx_lote_fornecedor  on lote (tenant_id, fornecedor_id) where fornecedor_id is not null;
create index if not exists idx_lote_compra_item on lote (compra_item_id) where compra_item_id is not null;
create index if not exists idx_etiqueta_lote    on etiqueta_validade (lote_id) where lote_id is not null;
