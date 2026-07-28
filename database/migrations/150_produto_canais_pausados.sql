-- 150 — Disponibilidade por canal de integração (delivery marketplaces).
-- Lista de canais (código da integração: 'ifood', '99food', 'anotaai', ...) em que
-- este produto está PAUSADO/oculto. Vazio = disponível em todos os canais ativos
-- (respeitando ainda disponivel_cardapio). Alimenta o toggle "Ativo no iFood" etc.
-- Enforcement: catalogoParaSync (Orzuni→iFood, GoGeM) expõe o campo; e
-- lerCatalogoParaExport(canal) filtra o produto do export daquele canal (99food, cardápio web).
alter table produto
  add column if not exists canais_pausados jsonb not null default '[]'::jsonb;
