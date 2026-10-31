-- 346_pedido_observacao.sql — a OBSERVAÇÃO DO PEDIDO (observação geral, além da de cada item).
--
-- ⚠️ NÃO é @cloud-only: `pedido_externo` existe na nuvem e no servidor da loja e sincroniza nos dois sentidos. O sync lê
--    as colunas de cada lado: enquanto a loja não recebe esta migration (vem no .zip), a coluna que a nuvem manda a mais
--    é ignorada lá (o pedido chega, só sem a observação); depois do .zip, a reconciliação traz a coluna das linhas
--    recentes. A observação nasce SÓ na nuvem (cardápio online e robô do WhatsApp): a cópia da loja não a sobrescreve no
--    envio (`sync.service.ts`) — a loja sem a coluna mandaria nula.
-- ⚠️ Vai pelo MCP do Supabase: sem instrução destrutiva (V9, ERR-225). Idempotente. Coluna nova SEM default: o Postgres
--    só muda o catálogo (não reescreve a tabela). Sem CHECK de tamanho (o limite é do serviço): uma regra diferente entre
--    a nuvem e a loja viraria linha "veneno" no sync.
--
-- Pedido do dono (31/10/2026): "cada produto pode ter sua observação própria, e o pedido final pode ter sua observação,
-- ex.: 'interfone ruim, ligar ao chegar, não buzinar'". Aparece no painel do delivery, na via do entregador, no app e
-- na página do entregador e nos resumos do robô; o cliente escreve no cardápio online ("＋ Adicionar observação") ou
-- pelo robô ("Pôr observação"). Uma linha só, até 300 letras (o serviço troca quebra de linha por espaço: a via
-- impressa lê marcas no começo da linha).
set local lock_timeout = '5s';

alter table pedido_externo add column if not exists observacao text;

-- Conferência no MESMO Run: a linha tem de vir com `ok = true`.
select 'coluna pedido_externo.observacao (text)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'pedido_externo'
                  and column_name = 'observacao' and data_type = 'text') as ok;
