-- 206_despacho_token_default.sql — despacho_token ESTÁVEL desde a criação do pedido.
--
-- Antes o token era setado tarde (ao imprimir o cupom do entregador, no EDGE). Como
-- pedido_externo é LWW bidirecional por updated_at, o token gerado no edge se perdia
-- no sync: o push perdia a corrida para atualizações de status vindas da nuvem
-- (anotaai/ifood/cardápio), e o pull podia até sobrescrever o token local com null.
-- Resultado: o app do entregador (que só fala com a NUVEM) nunca achava o pedido pelo
-- token (scan → "pedido não encontrado nesta loja").
--
-- Solução: o token nasce JUNTO com a linha (mesmo updated_at inicial), então
-- sincroniza sem corrida em ambos os sentidos. O tokenDespacho() do backend já é
-- idempotente (retorna o existente), então vira no-op seguro.
--
-- NÃO @cloud-only: pedido_externo existe na nuvem E no edge, e os dois criam pedidos.
-- Sem pgcrypto (o Postgres do edge pode não ter a extensão): 12 hex via md5(random()).
-- Formato idêntico ao randomBytes(6).toString('hex') usado no código (12 chars [0-9a-f]).

alter table pedido_externo
  alter column despacho_token
  set default substr(md5(random()::text || clock_timestamp()::text), 1, 12);

-- Backfill idempotente dos pedidos existentes sem token (o id entra no hash p/ garantir
-- unicidade por linha). Isso bumpa updated_at → os tokens propagam no próximo sync.
update pedido_externo
  set despacho_token = substr(md5(random()::text || clock_timestamp()::text || id::text), 1, 12)
  where despacho_token is null;
