-- 252_permissao_desperdicio.sql — Permissão própria para registrar desperdício e operar
-- o ponto de baixa, gravada nos perfis que JÁ EXISTEM conforme o nível de cada um.
--
-- ⚠️ NÃO é @cloud-only: `perfil_acesso` desce para o servidor local, onde o desperdício é
-- registrado. Aplicar na nuvem E no edge.
-- ⚠️ Nuvem ANTES do merge: sem ela, a gerência dos perfis existentes perde o registro de
-- desperdício no dia do deploy (explicado abaixo).
--
-- DECISÃO DO DONO
-- O desperdício é registrado pelo perfil de GESTÃO que tiver a permissão. A permissão
-- pode ser habilitada num perfil de EXECUÇÃO quando necessário, mas NÃO vem habilitada
-- por padrão na execução. O interruptor fica em Acessos & Perfis (a chave `desperdicio`
-- entrou no catálogo).
--
-- POR QUE UMA MIGRATION E NÃO SÓ O PADRÃO NO CÓDIGO
-- O pacote salvo em `perfil_acesso.permissoes` é usado COMO ESTÁ — não é mesclado com o
-- padrão do nível. Para os perfis já existentes a chave nova estaria AUSENTE, e as duas
-- saídas sem migration erram:
--   • sem herança → ausente = negado → TODA a gerência perderia o registro no deploy;
--   • herdando de `estoque` (PERM_FALLBACK) → um perfil de execução que alguém liberou
--     só para VER estoque ganharia desperdício sem ninguém pedir — o oposto da decisão.
-- Gravar a chave explicitamente, pelo nível do perfil, dá o comportamento exato: gestão
-- ligada, execução desligada. Perfil que já tiver a chave (editado depois) não é tocado.

update perfil_acesso
   set permissoes = jsonb_set(
         coalesce(permissoes, '{}'::jsonb),
         '{desperdicio}',
         to_jsonb(nivel in ('presidente', 'gerente', 'supervisao')),
         true
       ),
       updated_at = now()
 where not (coalesce(permissoes, '{}'::jsonb) ? 'desperdicio');
