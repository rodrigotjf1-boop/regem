-- 454 · ALÉRGENOS DO CARDÁPIO (D2 do atendente virtual; protótipo `mockups/regem-atendente-alergenos-agendado.html`, parte 1,
-- decisões A1–A9 aprovadas pelo dono em 16/11/2026 com as recomendadas; "pode" em 18/11). Nas DUAS pontas (nuvem e loja):
-- o insumo, o produto e a configuração do cardápio sincronizam pelo `updated_at` (sync-daemon), e o servidor da loja mostra
-- os mesmos cadastros.
--
-- O que entra (todas as colunas nascem vazias = como é hoje):
--   item_estoque.alergenos — a marcação do INSUMO pelo rótulo (Estoque › Produtos › gaveta, grupo "Alérgenos e restrições"):
--     { conferido, contem[], podeConter[], gluten, lactose }. Vazio = ninguém conferiu: os produtos que usam o insumo ficam
--     "não informado" no que não se sabe (A2 — ausência nunca se presume). A regra: `backend/src/common/alergenos.ts`.
--   produto.alergenos_ajuste — o ajuste à mão no PRODUTO do cardápio (A3: só soma cautela ao que vem da ficha; no produto
--     sem ficha, é a própria marcação). Mesma forma.
--   cardapio_config.alergenos_cautela — a frase de cautela da loja (A9; Delivery › Configurações › Cardápio digital ›
--     Cardápio, grupo "Alérgenos"). Vazio = a frase padrão; a tela não aceita gravar vazia.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Coluna sem padrão = só o catálogo muda; o
-- `lock_timeout` desiste em vez de enfileirar escrita atrás da tabela.
set local lock_timeout = '5s';

alter table item_estoque add column if not exists alergenos jsonb;
alter table produto add column if not exists alergenos_ajuste jsonb;
alter table cardapio_config add column if not exists alergenos_cautela text;
