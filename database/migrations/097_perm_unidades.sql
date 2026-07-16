-- 097 — permissão de navegação "unidades" (Configurações → Unidades).
-- Cadastro/edição das lojas da rede. Padrão: presidente e gerente podem; demais não.
-- (backend já enforça @Roles('presidente','gerente') no UnidadeController.)

update perfil_acesso
set permissoes = permissoes || case
  when nivel in ('presidente', 'gerente') then '{"unidades":true}'::jsonb
  else '{"unidades":false}'::jsonb
end
where not (permissoes ? 'unidades');
