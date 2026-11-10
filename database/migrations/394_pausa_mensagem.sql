-- 394 — A pausa dos pedidos, F3: a mensagem pronta ao cliente, editável (protótipo `mockups/regem-pausa.html`, aprovado em
-- 10/11/2026; pedido do dono: "uma mensagem automática bem formatada, com espaços e emojis, dizendo que os pedidos estão
-- pausados, com o horário em que retorna e o motivo do fechamento temporário").
--
-- `pausa_mensagem` — o texto que o atendente manda quando o cliente escreve com o cardápio digital pausado (e que o
-- cardápio online mostra, se a loja mudou). Com `{nome}`, `{motivo}` e `{volta}`. NULO = o texto padrão do Regem
-- (`MENSAGEM_DA_PAUSA_PADRAO`, em `backend/src/common/pausa-do-canal.ts`) — "Voltar ao texto padrão" grava nulo.
--
-- Mora no `cardapio_config` da LOJA EM USO (sem linha dela, a da empresa), como o aviso da F2 (mig 393): sincroniza nos
-- dois sentidos. Sem `check` no tamanho (o serviço confere: até 700 letras).
--
-- NÃO é @cloud-only (o `select` do cardápio lê todas as colunas, também no servidor da loja). ⚠️ Aplicar na NUVEM ANTES do
-- merge. Idempotente.

alter table cardapio_config add column if not exists pausa_mensagem text;

-- ===== Conferência (no mesmo Run): a linha tem de vir com `ok = true` =====
select 'coluna pausa_mensagem' as objeto,
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'cardapio_config' and column_name = 'pausa_mensagem') = 1 as ok;
