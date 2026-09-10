-- 235_tarefa_horario_fim_prioridade.sql — tarefa_def ganha HORÁRIO FINAL, PRIORIDADE e
-- rastreio de QUEM CRIOU (p/ a trava de editar/excluir por nível: gerência edita o que
-- a gerência criou; o que a presidência criou, só a presidência mexe). Aditivo/idempotente.
-- NÃO cloud-only: tarefas existem também no edge (Meu Dia offline).

alter table tarefa_def add column if not exists horario_fim time;                 -- horário final (opcional)
alter table tarefa_def add column if not exists prioridade text;                  -- alta | media | baixa (null = sem)
alter table tarefa_def add column if not exists criado_por_id uuid;               -- colaborador que criou
alter table tarefa_def add column if not exists criado_por_nivel text;            -- presidente|gerente|supervisao|execucao (no ato)
