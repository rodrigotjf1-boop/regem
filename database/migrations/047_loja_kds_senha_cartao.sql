-- Cardápio digital: envio automático ao KDS + senha da plataforma + formas de cartão.

-- Config: enviar pedidos do cardápio direto ao KDS + rótulos de cartão aceitos.
alter table cardapio_config add column if not exists auto_kds boolean not null default true;
alter table cardapio_config add column if not exists formas_cartao jsonb not null default '[]';

-- Pedido de produção (KDS): de qual plataforma veio + a senha da plataforma.
alter table producao_pedido add column if not exists plataforma text;
alter table producao_pedido add column if not exists senha_plataforma text;

-- Pedido externo: forma de cartão (bandeira/tipo) escolhida pelo cliente.
alter table pedido_externo add column if not exists bandeira text;
