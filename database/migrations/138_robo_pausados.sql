-- 138_robo_pausados.sql — números de WhatsApp em que o robô (n8n) está PAUSADO
-- (o humano assumiu aquela conversa no inbox). O resolver do bot consulta essa lista
-- e devolve `pausado: true` para o n8n pular a resposta automática. Idempotente.

alter table cardapio_config add column if not exists robo_pausados jsonb not null default '[]';
