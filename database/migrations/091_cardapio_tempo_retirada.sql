-- Tempo estimado de RETIRADA (preparo) separado do tempo de entrega, para o
-- cliente ver a estimativa certa ao escolher Retirada no cardápio.
alter table cardapio_config add column if not exists tempo_retirada_min integer;
