-- Acessos & perfis passa a ser SÓ presidente/C&O (corrige o default da 093, que
-- tinha dado 'acessos' à gerência). Gerenciar perfis controla quem-pode-o-quê →
-- fica restrito ao C&O. Presidente mantém tudo. Não altera schema.
update perfil_acesso set permissoes = permissoes || '{"acessos":false}'::jsonb
  where nivel <> 'presidente';
