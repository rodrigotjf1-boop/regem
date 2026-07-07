-- 053 — Cardápio digital: dados da loja, endereço, tipos de pedido, horários
-- e liga/desliga por bairro na área de atendimento.

-- Loja (identidade + contatos)
alter table cardapio_config add column if not exists logo_ref text;            -- logo por imagem
alter table cardapio_config add column if not exists documento text;           -- cpf/cnpj
alter table cardapio_config add column if not exists responsavel_nome text;
alter table cardapio_config add column if not exists responsavel_contato text;
alter table cardapio_config add column if not exists contato_loja text;
alter table cardapio_config add column if not exists instagram text;
alter table cardapio_config add column if not exists site text;

-- Endereço da loja
alter table cardapio_config add column if not exists end_cep text;
alter table cardapio_config add column if not exists end_rua text;
alter table cardapio_config add column if not exists end_numero text;
alter table cardapio_config add column if not exists end_bairro text;
alter table cardapio_config add column if not exists end_cidade text;
alter table cardapio_config add column if not exists end_estado text;
alter table cardapio_config add column if not exists end_referencia text;
alter table cardapio_config add column if not exists end_complemento text;

-- Tipos de pedido (independentes): entrega / retirada / consumir no local
alter table cardapio_config add column if not exists tipo_delivery boolean not null default true;
alter table cardapio_config add column if not exists tipo_retirada boolean not null default false;
alter table cardapio_config add column if not exists tipo_local boolean not null default false;

-- Horários de funcionamento do delivery (jsonb: [{dia:0..6, abre:'HH:MM', fecha:'HH:MM', ativo:true}])
alter table cardapio_config add column if not exists horarios jsonb not null default '[]';

-- Área de atendimento: liga/desliga por bairro
alter table cardapio_bairro add column if not exists ativo boolean not null default true;
