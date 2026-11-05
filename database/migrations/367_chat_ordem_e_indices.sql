-- @cloud-only
-- 367 — A ORDEM DAS MENSAGENS DO CHAT DO iFOOD E DA 99 E OS ÍNDICES DA LEITURA POR HORA (ponte do chat, "Conversas agora").
--
-- (1) A ORDEM. A fala do cliente e a resposta do robô são gravadas na MESMA transação (a entrada das mensagens), e a
-- ponte traz várias falas de uma vez num lote só. Com `default now()` (o instante da TRANSAÇÃO) todas saem com a mesma
-- hora e o id aleatório decidia a ordem: a resposta do robô aparecia ANTES da pergunta, metade das vezes (ERR-379,
-- LIC-521). `clock_timestamp()` é a hora de cada linha: a ordem de gravação vira a ordem da conversa. Vale para todo
-- caminho que grava (a ponte, o robô, os avisos, a equipe); as linhas que já existem ficam como estão.
--
-- (2) OS ÍNDICES. As leituras que rodam a cada poucos segundos com a tela aberta pedem "as mensagens da empresa nas
-- últimas horas": a faixa da ponte (a última mensagem do dia, a cada leitura da fila), as "Conversas agora" (a última
-- hora, a cada 15 s) e a conta do robô (as respostas na última hora). O índice da 366 (`tenant_id, unidade_id,
-- criado_em`) não serve quando a loja não está escolhida (empresa de loja única, presidente em "todas as lojas"): o
-- Postgres de produção (17) não pula a coluna do meio e lê o histórico inteiro da empresa. A conversa de um caso e a conta
-- do robô também procuram pelo pedido da plataforma (`pedido_externo`), que não tinha índice.
--
-- Só na nuvem, como a 366: as mensagens do chat moram lá.

alter table chat_plataforma_msg alter column criado_em set default clock_timestamp();

create index if not exists idx_chat_msg_empresa_hora on chat_plataforma_msg (tenant_id, criado_em desc);
create index if not exists idx_chat_msg_pedido_externo
  on chat_plataforma_msg (tenant_id, canal, pedido_externo, criado_em) where pedido_externo is not null;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'criado_em pela hora de cada linha (clock_timestamp)' as objeto,
       (select column_default from information_schema.columns
         where table_schema = current_schema() and table_name = 'chat_plataforma_msg' and column_name = 'criado_em')
         = 'clock_timestamp()' as ok
union all
select 'índices do chat por hora e pelo pedido da plataforma',
       (select count(*) = 2 from pg_indexes
         where schemaname = current_schema()
           and indexname in ('idx_chat_msg_empresa_hora', 'idx_chat_msg_pedido_externo'));
