-- 144_perfil_execucao_login_web.sql — libera o login do time de execução (Fase 1).
--
-- Complemento da mig 141. Não basta o colaborador ter usuário e senha: o perfil
-- de acesso também precisa permitir entrar (`login_web`). Os perfis de Execução
-- foram semeados com `false`, o que contradizia as próprias permissões deles —
-- o mesmo perfil já vinha com pdv/mesas/pedidos liberados, mas sem porta de
-- entrada para usá-los.
--
-- Efeito: o atendente passa a entrar com o próprio usuário, e o caixa/auditoria
-- param de registrar tudo no nome de quem abriu o navegador.
--
-- Continua configurável: quem quiser um perfil só-terminal é só desmarcar
-- "acessa pela web" no editor de perfis. Idempotente.

update perfil_acesso
   set login_web = true,
       updated_at = now()
 where nivel = 'execucao'
   and login_web = false;
