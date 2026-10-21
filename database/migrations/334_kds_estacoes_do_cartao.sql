-- Cozinha em estações, entrega 2 — fluxo entre KDS e despacho (decisão do dono, 21/10/2026).
-- O cartão anda de KDS em KDS quando a estação marca PRONTO (antes pulava no primeiro toque) e começa no seguinte como
-- recebido; o KDS de despacho mostra o pedido inteiro, com o andamento de cada estação. Aqui fica por quais estações o
-- cartão já passou, na ordem: [{"kds": "<id do KDS>", "pronto": "<quando ficou pronto lá>"}, ...]; a passagem feita
-- pelo "Despachar assim mesmo" do gerente leva "forcado": true.
-- Nas duas pontas (nuvem e servidor da loja). Sincroniza com o cartão: cada ponta grava só as colunas que a tabela dela
-- tem, então o servidor da loja ainda sem esta coluna ignora o campo até receber o pacote novo.
alter table producao_pedido add column if not exists estacoes jsonb default '[]'::jsonb;
