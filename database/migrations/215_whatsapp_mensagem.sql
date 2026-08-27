-- @cloud-only
-- 215_whatsapp_mensagem.sql — histórico de conversas do WhatsApp na API oficial.
--
-- Por que existe: no Evolution o espelho do painel funciona porque o PRÓPRIO Evolution
-- guarda o histórico (findChats/findMessages). **A Meta não guarda.** A Cloud API
-- entrega o evento uma vez e esquece. Sem esta tabela, uma loja migrada para o oficial
-- perderia o chat do `/delivery` — que é a tela onde o atendente assume a conversa.
--
-- Guardamos as duas direções: o que o cliente manda e o que sai daqui (robô ou humano).
--
-- `wamid` é o id da mensagem na Meta. O UNIQUE por tenant é idempotência de verdade:
-- a Meta REENVIA o webhook quando não recebe 200 a tempo, e sem essa trava a mesma
-- mensagem apareceria duplicada no painel.
--
-- @cloud-only: só a nuvem fala com a Meta. Criar esta tabela no banco da loja seria
-- carregar peso morto para todo edge instalado.
-- Aditiva e idempotente.

create table if not exists whatsapp_mensagem (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references empresa(id) on delete cascade,
  telefone     text not null,                    -- só dígitos (cliente)
  direcao      text not null,                    -- 'entrada' | 'saida'
  tipo         text not null default 'text',     -- text | image | audio | document | ...
  texto        text,
  midia_id     text,                             -- id da mídia na Meta (baixável pelo proxy)
  wamid        text,                             -- id da mensagem na Meta
  status       text,                             -- só saída: accepted | sent | delivered | read | failed
  nome_contato text,
  criado_em    timestamptz not null default now()
);

-- Listagem da conversa e o "quem falou por último" da lista de conversas.
create index if not exists whatsapp_mensagem_tenant_tel_idx
  on whatsapp_mensagem (tenant_id, telefone, criado_em desc);

-- Idempotência do webhook: a Meta reenvia o evento se não receber 200 a tempo.
create unique index if not exists whatsapp_mensagem_wamid_uq
  on whatsapp_mensagem (tenant_id, wamid)
  where wamid is not null;
