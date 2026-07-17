-- 107_tarefa_setor_funcao_fotos.sql
-- Controle de tarefas: cadastro por SETOR (opcional) + FUNCAO (obrigatoria) no lugar
-- da etiqueta; fotos de comprovacao (ate 3) com expurgo em 30 dias; responsavel
-- resolvido pela escala (ou em aberto). A politica "exigir foto" fica em entitlement
-- (tarefa_foto_conclusao / tarefa_foto_parcial), sem coluna nova.

-- Definicao da tarefa: funcao alvo (setor_id ja existe).
alter table tarefa_def
  add column if not exists funcao_id uuid references funcao(id);

-- Instancia do dia: snapshot de funcao/setor + fotos + expurgo LGPD.
alter table tarefa_instancia
  add column if not exists funcao_id uuid references funcao(id),
  add column if not exists setor_id uuid references setor(id),
  add column if not exists fotos jsonb not null default '[]'::jsonb,
  add column if not exists data_expurgo date;

create index if not exists idx_tarefa_inst_expurgo
  on tarefa_instancia (data_expurgo) where data_expurgo is not null;
