-- 301 — Totem (hub Retirada / Encomendas): o pedido do totem JÁ PAGO sai da lista quando a
-- cozinha marca PRONTO (decisão do dono, 30/09/2026). Desligado (padrão) = como hoje: o pago
-- continua na lista até o balcão clicar "Entregar".
--
-- Ligado, o "pronto" do KDS conclui o pedido pago sozinho — o mesmo "Entregar" do balcão
-- (baixa de estoque idempotente, status-back) —, e ele sai da lista. A senha segue no KDS /
-- quadro de senhas, que lê a PRODUÇÃO, não o pedido.
--
-- NÃO é @cloud-only: `delivery_config` existe nos dois bancos e sincroniza nos dois sentidos — o
-- servidor da loja (onde o KDS marca pronto) precisa ler a chave. Fica FORA do schema do Drizzle
-- e é lida por SQL cru, como a `totem_producao_apos_pagamento` (mig 217): servidor sem a coluna
-- (antes do `.zip`) lê o padrão e nada quebra. Config da REDE (linha com `unidade_id` nulo).
-- Idempotente.
set local lock_timeout = '5s';

alter table delivery_config
  add column if not exists totem_conclui_ao_ficar_pronto boolean not null default false;

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`.
select 'coluna delivery_config.totem_conclui_ao_ficar_pronto' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'delivery_config'
                  and column_name = 'totem_conclui_ao_ficar_pronto'
                  and data_type = 'boolean' and is_nullable = 'NO') as ok
union all
select 'padrão desligado (como hoje)',
       coalesce((select column_default from information_schema.columns
                  where table_schema = current_schema() and table_name = 'delivery_config'
                    and column_name = 'totem_conclui_ao_ficar_pronto'), '') = 'false';
