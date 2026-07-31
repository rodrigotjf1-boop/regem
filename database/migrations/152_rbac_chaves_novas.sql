-- 152 — chaves novas de RBAC (completa o catálogo): fichas, bot, desligamento,
-- guias, vistoria, desempenho. Backfill dos perfis existentes por nível.
-- `default || permissoes`: em jsonb o lado DIREITO vence no conflito, então as
-- chaves que o presidente já editou PERMANECEM e só as NOVAS entram com o default.
-- Não altera schema (perfil_acesso.permissoes já é jsonb).

-- Presidente: tudo liberado.
update perfil_acesso set permissoes =
  '{"fichas":true,"bot":true,"desligamento":true,"guias":true,"vistoria":true,"desempenho":true}'::jsonb
  || permissoes where nivel = 'presidente';

-- Gerência: gestão completa da loja (inclui fichas/bot/desligamento/POP/vistoria/desempenho).
update perfil_acesso set permissoes =
  '{"fichas":true,"bot":true,"desligamento":true,"guias":true,"vistoria":true,"desempenho":true}'::jsonb
  || permissoes where nivel = 'gerente';

-- Supervisão: operação do setor; SEM bot/desligamento (gestão/RH).
update perfil_acesso set permissoes =
  '{"fichas":true,"bot":false,"desligamento":false,"guias":true,"vistoria":true,"desempenho":true}'::jsonb
  || permissoes where nivel = 'supervisao';

-- Execução: consulta POP e faz vistoria; sem fichas/bot/desligamento/desempenho.
update perfil_acesso set permissoes =
  '{"fichas":false,"bot":false,"desligamento":false,"guias":true,"vistoria":true,"desempenho":false}'::jsonb
  || permissoes where nivel = 'execucao';
