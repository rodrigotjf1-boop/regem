-- 350_chamado_fila.sql — o chamado de atendimento vira CASO DE FILA (central de atendimento, Onda 1, PR 1a).
--
-- ⚠️ NÃO é @cloud-only: `atendimento_chamado` existe na nuvem e no servidor da loja e sincroniza nos dois sentidos
--    (sync-config: direcao 'ambos', cursor `atualizado_em`). O sync lê as colunas de cada lado: enquanto a loja não
--    recebe esta migration (vem no .zip), as colunas que a nuvem manda a mais são ignoradas lá.
-- ⚠️ Vai pelo MCP do Supabase: sem instrução destrutiva (V9, ERR-225). Idempotente. Colunas sem default (nullable):
--    o Postgres não reescreve a tabela.
--
-- Pedido do dono (01/11/2026, protótipo aprovado em 02/11): uma fila só, com responsável, "aguardando o cliente" e prazo.
--   responsavel_id   — quem pegou o caso (colaborador). NULL = na fila.
--   pego_em          — quando o responsável atual pegou (mede o tempo até alguém pegar).
--   aguardando_desde — NULL = não está esperando o cliente; preenchido = "aguardando o cliente" (volta para a fila
--                      quando o cliente responde).
--   canal            — de onde veio o caso: whatsapp | cardapio | anotaai | ifood | 99food (NULL = chamado antigo).
--   prazo_em         — até quando a loja tem de responder (disputa do iFood, pedido da 99). NULL = sem prazo.
set local lock_timeout = '5s';

alter table atendimento_chamado add column if not exists responsavel_id uuid;
alter table atendimento_chamado add column if not exists pego_em timestamptz;
alter table atendimento_chamado add column if not exists aguardando_desde timestamptz;
alter table atendimento_chamado add column if not exists canal text;
alter table atendimento_chamado add column if not exists prazo_em timestamptz;

-- A fila lê os abertos da empresa em ordem; o índice de (tenant_id, status) da mig 058 já cobre o filtro.
-- O "comigo" filtra por responsável dentro dos abertos.
create index if not exists idx_atendimento_chamado_responsavel
  on atendimento_chamado (tenant_id, responsavel_id)
  where status = 'aberto';
