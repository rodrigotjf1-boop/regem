-- 141_colaborador_usuario_login.sql — login para TODA a hierarquia (Fase 1).
--
-- Hoje só presidente/gerente/supervisão conseguem entrar, porque o login é por
-- e-mail (global) + senha, e o cadastro bloqueia senha para execução. Só que o
-- atendente opera o Regem o turno inteiro (PDV, delivery, caixa) — ele precisa
-- de credencial própria, senão tudo que ele faz fica registrado no nome de quem
-- abriu o navegador (hoje: o presidente).
--
-- `usuario` é o apelido de login, único DENTRO da empresa (não no mundo): assim
-- "joao" pode existir em mil lojas e ninguém precisa inventar e-mail. O e-mail
-- continua funcionando em paralelo para quem já usa. Idempotente.

alter table colaborador add column if not exists usuario text;

-- Único por empresa, sem diferenciar maiúscula/minúscula, ignorando excluídos.
create unique index if not exists colaborador_usuario_tenant_uidx
  on colaborador (tenant_id, lower(usuario))
  where usuario is not null and deleted_at is null;
