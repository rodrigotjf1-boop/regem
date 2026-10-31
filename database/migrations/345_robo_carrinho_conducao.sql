-- @cloud-only
-- 345 · O ROBÔ CONDUZ O PEDIDO PASSO A PASSO (Fase 5, F5 — teste do dono no celular, 31/10/2026).
-- Só NUVEM, como a 344 (a tabela `robo_carrinho` só existe na nuvem).
--
-- O que entra no carrinho do robô (três colunas novas, todas opcionais):
--   resumo_versao  — a versão do pedido cujo RESUMO PARA CONFERIR o Regem mandou ao cliente (com os botões "Pode
--                    registrar / Pôr observação / Quero mudar algo"). Registrar exige resumo_versao = versao: o cliente
--                    viu exatamente o que vai ser gravado — sem depender de a IA repetir um número entre mensagens
--                    (no teste, a memória do n8n não guardava a versão e o "Pode registrar" virou um ciclo).
--   itens_fechados — o cliente disse que é "só isso" (o robô já perguntou "mais alguma coisa?" e ofereceu a bebida):
--                    o próximo passo é a entrega.
--   observacao     — a observação GERAL do pedido ("interfone ruim, ligar ao chegar, não buzinar"), pedido do dono.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. A tabela tem poucas linhas.
set local lock_timeout = '5s';

alter table robo_carrinho add column if not exists resumo_versao integer;
alter table robo_carrinho add column if not exists itens_fechados boolean not null default false;
alter table robo_carrinho add column if not exists observacao text;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'coluna robo_carrinho.resumo_versao (integer)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_carrinho'
                  and column_name = 'resumo_versao' and data_type = 'integer') as ok
union all
select 'coluna robo_carrinho.itens_fechados (boolean, não nula)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_carrinho'
                  and column_name = 'itens_fechados' and data_type = 'boolean' and is_nullable = 'NO')
union all
select 'coluna robo_carrinho.observacao (text)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_carrinho'
                  and column_name = 'observacao' and data_type = 'text');
