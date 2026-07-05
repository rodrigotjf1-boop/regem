-- Fase L2 — Motor da Loja: dados da loja + tema por ramo + frete/pagamento na
-- config do cardápio (estende cardapio_config).

alter table cardapio_config add column if not exists ramo text not null default 'food'; -- food|varejo|industria|servicos
alter table cardapio_config add column if not exists logo_emoji text;
alter table cardapio_config add column if not exists subtitulo text;
alter table cardapio_config add column if not exists aberto boolean not null default true;   -- aberto/fechado manual
alter table cardapio_config add column if not exists tempo_entrega_min integer;
alter table cardapio_config add column if not exists pedido_minimo numeric;
alter table cardapio_config add column if not exists avaliacao numeric;
alter table cardapio_config add column if not exists frete_gratis_acima numeric;
alter table cardapio_config add column if not exists pagamentos jsonb not null default '[]'; -- ['pix','cartao','entrega','vr']
alter table cardapio_config add column if not exists fidelidade_ativa boolean not null default false;
alter table cardapio_config add column if not exists whatsapp text;
