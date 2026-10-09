-- 310 — O PEDIDO DE PRODUÇÃO leva "comer aqui / viagem" (decisão do dono em 09/10/2026: a cozinha
-- vê "VIAGEM" no cartão e no alto da via impressa; vale para o balcão e para o totem).
--
-- A venda do totem já gravava `comanda.consumo` ('local' | 'viagem', mig 151) e ninguém lia: a tela
-- da cozinha e a via de produção leem o PEDIDO DE PRODUÇÃO, que não tinha onde guardar a marca
-- (ERR-214). O cliente escolhia "para viagem" no totem e o pedido chegava à cozinha igual ao de
-- quem come no local.
--
-- `producao_pedido.consumo`: a mesma marca da comanda, copiada quando o pedido de produção nasce.
-- NULL = não informado (tudo o que existe hoje; mesa, delivery e canais continuam sem a marca).
--
-- NÃO é @cloud-only: `producao_pedido` existe nos dois bancos e sincroniza nos dois sentidos (o
-- sync reconcilia coluna nova sozinho a partir da 1.30.0). Coluna sem valor padrão não regrava a
-- tabela. Idempotente.
set local lock_timeout = '5s';

alter table producao_pedido add column if not exists consumo text;

-- Conferência no MESMO Run: a linha tem de vir com `ok = true`.
select 'producao_pedido.consumo (text, opcional)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'producao_pedido'
                  and column_name = 'consumo' and data_type = 'text' and is_nullable = 'YES') as ok;
