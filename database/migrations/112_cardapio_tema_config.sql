-- Personalização do tema do cardápio digital (botão "Editar tema"): cor primária,
-- toggles de destaques/banner/últimos pedidos e intervalo do carrossel de banners.
-- Tudo num JSONB aditivo (sem novas colunas soltas). Vazio = defaults no código.
alter table cardapio_config add column if not exists tema_config jsonb not null default '{}'::jsonb;
