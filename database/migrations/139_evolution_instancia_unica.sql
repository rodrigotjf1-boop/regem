-- 139_evolution_instancia_unica.sql — isolamento multi-tenant do WhatsApp.
-- Uma instância do Evolution pertence a UMA loja só: sem isto, duas lojas podiam
-- apontar para a mesma conexão e uma leria as conversas da outra. O serviço já
-- valida em código; este índice é a garantia no banco (fecha corrida entre duas
-- requisições simultâneas). Parcial: ignora as lojas ainda sem instância.
-- Idempotente.

create unique index if not exists cardapio_config_evolution_instancia_uidx
  on cardapio_config (evolution_instancia)
  where evolution_instancia is not null;
