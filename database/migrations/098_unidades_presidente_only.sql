-- 098 — visão/gestão de unidades passa a ser EXCLUSIVA do presidente/C&O.
-- Revoga a permissão `unidades` de todos os perfis não-presidente (a 097 havia
-- concedido ao gerente). O backend também reforça com @Roles('presidente') no
-- UnidadeController e o seletor de unidade só aparece para o presidente.

update perfil_acesso
set permissoes = permissoes || '{"unidades":false}'::jsonb
where nivel <> 'presidente';
