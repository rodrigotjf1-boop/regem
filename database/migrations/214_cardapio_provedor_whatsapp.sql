-- 214_cardapio_provedor_whatsapp.sql — provedor de WhatsApp POR LOJA e as chaves da
-- API oficial (Meta Cloud API).
--
-- Por que: o Regem passa a falar WhatsApp por dois caminhos — Evolution (não oficial,
-- pareamento por QR) e Cloud API (oficial, da Meta). Em vez de trocar um pelo outro e
-- derrubar quem já está no ar, cada loja escolhe o seu e migra quando quiser.
--
--   provedor = 'evolution' -> instância do Evolution (evolution_instancia)
--   provedor = 'cloud'     -> número na Meta        (wa_cloud_phone_id)
--
-- O DEFAULT é 'evolution' de propósito: toda loja existente continua exatamente como
-- está, sem nenhuma ação do lojista.
--
-- wa_cloud_phone_id é a CHAVE MULTI-TENANT do lado da Meta. A URL de callback do
-- webhook é UMA SÓ para todas as lojas — o que diz de quem é a mensagem é o
-- metadata.phone_number_id que vem no payload. É o papel que evolution_instancia já
-- faz hoje do lado do Evolution.
--
-- O índice único é PARCIAL (só linhas preenchidas): impede duas lojas reivindicarem o
-- mesmo número — o que deixaria uma lendo as conversas da outra — e ao mesmo tempo
-- permite que as N lojas sem Cloud API fiquem com NULL.
--
-- NÃO @cloud-only: cardapio_config existe na nuvem E no edge (mesma situação da mig
-- 197). O edge ignora as colunas novas; só a nuvem fala com a Meta.
-- Aditiva e idempotente.

alter table cardapio_config
  add column if not exists provedor text not null default 'evolution';

alter table cardapio_config
  add column if not exists wa_cloud_phone_id text;

alter table cardapio_config
  add column if not exists wa_cloud_waba_id text;

alter table cardapio_config
  add column if not exists wa_cloud_numero text;

create unique index if not exists cardapio_config_wa_cloud_phone_id_uq
  on cardapio_config (wa_cloud_phone_id)
  where wa_cloud_phone_id is not null;
