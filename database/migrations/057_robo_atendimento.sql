-- 057 — Robô de auto atendimento (mensagens pré-definidas). O "cérebro" com
-- IA/LLM fica para uma etapa dedicada; aqui guardamos a config + o prompt.

alter table cardapio_config add column if not exists robo_ativo boolean not null default false;
alter table cardapio_config add column if not exists robo_saudacao text;
alter table cardapio_config add column if not exists robo_ausencia text;
alter table cardapio_config add column if not exists robo_prompt text; -- base de conhecimento (futuro LLM)
-- Mensagens pré-definidas: [{gatilho, resposta}]
alter table cardapio_config add column if not exists robo_mensagens jsonb not null default '[]';
