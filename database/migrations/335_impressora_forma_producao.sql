-- Cozinha em estações, entrega 3 — cada impressora de produção com a sua FORMA de imprimir (decisão do dono, 21/10/2026).
--   'itens'    = só os itens desta impressora (como sempre foi — o padrão: nada muda até alguém escolher);
--   'completo' = o pedido inteiro: os itens desta impressora em destaque (negrito) e os outros em letra pequena, com o
--                destino entre parênteses ("1x Refrigerante lata (Despacho)").
-- Sem "agrupado" na impressora (decisão do dono, 21/10): agrupar fica no KDS, na visão Por item.
-- Nas duas pontas (nuvem e servidor da loja). O cadastro do equipamento sincroniza a linha inteira; quem ainda não tem a
-- coluna ignora o campo até receber o pacote novo.
alter table equipamento add column if not exists forma_producao text not null default 'itens';
