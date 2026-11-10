-- 396 — A pausa dos pedidos, F4: a resposta em ÁUDIO quando o cliente insiste (protótipo `mockups/regem-pausa.html`,
-- aprovado em 10/11/2026; o dono: "decidir enviar um áudio quando o cliente não entender ou insistir em fazer pedido com a
-- loja fechada, porque tem mais chances de o cliente escutar e entender" e "a mensagem de voz é a mesma que o atendimento
-- Regem já usa: ao invés de uma mensagem de texto, só substituir por uma de áudio, não precisa de workflow novo").
--
-- `pausa_audio` — ligado (o padrão do protótipo), quando o cliente que JÁ recebeu a mensagem pronta da pausa (F3) insiste
-- em pedir ou diz que não entendeu, a mensagem dele vai ao robô marcada `responderFalado: true` e a resposta do robô sai em
-- áudio, com a mesma voz que o atendimento usa quando o cliente manda áudio — uma vez por cliente em cada pausa; só no
-- WhatsApp (no Direct e no Messenger o atendente não manda áudio). Depende da linha do nó "Prepara a resposta" do n8n
-- (o dono troca): sem ela, a marca é ignorada e a resposta sai em texto, como hoje.
--
-- Mora no `cardapio_config` da LOJA EM USO (sem linha dela, a da empresa), como o aviso (393) e a mensagem (394).
-- NÃO é @cloud-only (o `select` do cardápio lê todas as colunas, também no servidor da loja). ⚠️ Aplicar na NUVEM ANTES do
-- merge. Idempotente.

alter table cardapio_config add column if not exists pausa_audio boolean not null default true;

-- ===== Conferência (no mesmo Run): a linha tem de vir com `ok = true` =====
select 'coluna pausa_audio (padrão ligado)' as objeto,
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'cardapio_config' and column_name = 'pausa_audio'
           and column_default = 'true') = 1 as ok;
