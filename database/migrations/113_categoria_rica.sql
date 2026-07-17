-- Categoria do cardápio mais rica: foto, descrição e disponibilidade (dias/horários).
-- disponibilidade = array JSONB de janelas [{ dias:[0..6], inicio:'HH:MM', fim:'HH:MM' }];
-- vazio = sempre visível. Ordem (arrastar) já usa a coluna `ordem` existente. Aditivo.
alter table categoria_produto add column if not exists imagem_ref text;
alter table categoria_produto add column if not exists descricao text;
alter table categoria_produto add column if not exists disponibilidade jsonb not null default '[]'::jsonb;
