-- 110_cardapio_menu_theme.sql
-- Sistema de temas/layout do cardápio digital (só apresentação). `menu_theme`
-- seleciona o TEMPLATE de layout por loja: 'classic' (atual, padrão/fallback) ou
-- 'fastfood' (novo). Independente do `tema` (claro/escuro) e do `ramo`. Aditiva.

alter table cardapio_config
  add column if not exists menu_theme text not null default 'classic';
