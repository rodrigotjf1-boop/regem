-- @cloud-only
-- 363 · O ROBÔ MUDA O PEDIDO JÁ FEITO (PR 3 do pedido repetido/alterado; pedido do dono de 03/11/2026, protótipo
-- `mockups/regem-alteracao-pedido.html`, vista "Robô do WhatsApp" — decisões 3A, 4A e 7). Só NUVEM, como a 344/345/361
-- (as tabelas `robo_carrinho` e `robo_config` só existem na nuvem).
--
-- robo_carrinho.mudanca — a mudança do pedido JÁ FEITO na conversa (`cardapio/robo-mudanca.ts`, MudancaDoRobo): o id
--                         (o da alteração — `pedido_alteracao.id`), o pedido, a operação (pôr, tirar ou trocar um item,
--                         com o preço do cardápio que o cliente confere), o troco, se a conferência saiu (só depois dela
--                         vale o "Pode alterar") e, depois do "Pode alterar", se foi aplicada ou pedida ao servidor da
--                         loja e se o cliente já soube da decisão. Nulo = nenhuma mudança na conversa.
-- robo_config.muda_pedido — "O robô faz mudanças simples no pedido" (Delivery › Configurações › Operação › Robô de
--                         atendimento): nasce LIGADO (decisão 3A); desligado, o robô passa toda mudança para a equipe.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. As tabelas têm poucas linhas.
set local lock_timeout = '5s';

alter table robo_carrinho add column if not exists mudanca jsonb;
alter table robo_config add column if not exists muda_pedido boolean not null default true;

-- A rotina que avisa o cliente da decisão da loja (`AvisoDaMudancaProcessor`, de 20 em 20 s, todas as lojas numa
-- consulta) procura só as mudanças PEDIDAS ao servidor da loja e ainda não avisadas: o índice parcial guarda só essas
-- (fica quase vazio), e a volta não lê o carrinho inteiro.
create index if not exists robo_carrinho_mudanca_pedida_idx on robo_carrinho ((mudanca->>'id'))
  where mudanca->>'situacao' = 'pedida' and coalesce(mudanca->>'avisada', 'false') <> 'true';

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'coluna robo_carrinho.mudanca (jsonb)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_carrinho'
                  and column_name = 'mudanca' and data_type = 'jsonb') as ok
union all
select 'coluna robo_config.muda_pedido (boolean)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_config'
                  and column_name = 'muda_pedido' and data_type = 'boolean')
union all
select 'índice robo_carrinho_mudanca_pedida_idx',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and indexname = 'robo_carrinho_mudanca_pedida_idx');
