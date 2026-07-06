-- Fase Loja checkout fiel — endereço estruturado no pedido + upsell por destaque.

-- Endereço estruturado (entrega): o campo `endereco` (texto) continua sendo
-- composto para impressão/compatibilidade; estas colunas guardam as partes.
alter table pedido_externo add column if not exists endereco_rua text;
alter table pedido_externo add column if not exists endereco_numero text;
alter table pedido_externo add column if not exists endereco_referencia text;
alter table pedido_externo add column if not exists endereco_bairro text; -- snapshot do nome do bairro
alter table pedido_externo add column if not exists cliente_telefone2 text;

-- Upsell "peça também": produtos marcados como sugeridos pelo gestor.
alter table produto add column if not exists destaque boolean not null default false;
