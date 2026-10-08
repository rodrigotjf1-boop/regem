-- 308 — Linha da ficha técnica com a quantidade e o custo SEM arredondamento (decisão do dono em
-- 08/10/2026: usar o produto do estoque pela unidade convertida — "1 kg = 72 unidades (fatias);
-- um produto com duas fatias de bacon").
--
-- A linha da ficha passa a guardar a quantidade na unidade do ESTOQUE: 2 fatias de um bacon em kg
-- = 0,027777… kg. A coluna era `numeric(12,3)` — três casas —, então gravava 0,028 kg: 0,8% a
-- mais de bacon baixado em toda venda, e a quantidade "andava" a cada vez que a ficha era salva
-- (3 fatias viravam 3,024). O custo unitário era `numeric(12,4)`.
--
-- As duas colunas ficam `numeric` sem limite de casas — como já são `movimento_estoque.quantidade`,
-- `lote.quantidade` e todas as outras quantidades de estoque. Tirar o limite não regrava a tabela
-- e não muda nenhum valor que já esteja lá.
--
-- NÃO é @cloud-only: `ficha_ingrediente` existe nos dois bancos (desce da nuvem para a loja).
-- Servidor de loja ainda sem esta migration guarda a linha com três casas — é o arredondamento
-- acima, não uma baixa errada de ordem de grandeza. Idempotente.
set local lock_timeout = '5s';

alter table ficha_ingrediente
  alter column quantidade type numeric,
  alter column custo_unitario type numeric;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'ficha_ingrediente.quantidade sem limite de casas' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'ficha_ingrediente'
                  and column_name = 'quantidade' and data_type = 'numeric'
                  and numeric_scale is null) as ok
union all
select 'ficha_ingrediente.custo_unitario sem limite de casas',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'ficha_ingrediente'
                  and column_name = 'custo_unitario' and data_type = 'numeric'
                  and numeric_scale is null);
