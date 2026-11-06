-- @cloud-only
-- 373 · O ROBÔ PÕE ITEM NO PEDIDO JÁ PAGO NO PIX (pedido do dono de 06/11/2026): o cliente pagou o pedido do cardápio no
-- Pix e, ainda em produção, pede para pôr um item ("manda uma coca lata também"). Até aqui o robô passava para a equipe
-- (decisão 4A: cobrar a diferença online não existia). Agora, com o ajuste ligado, o robô cobra a DIFERENÇA num Pix
-- copia-e-cola que vale 5 minutos; pago, a mudança entra pela MESMA alteração da equipe (`DeliveryService.alterar`, a via
-- "PEDIDO ALTERADO", o KDS, o total da venda). Só NUVEM, como a 363/372: o robô, os gateways e os avisos deles só existem
-- na nuvem (a loja com servidor ligado recebe a alteração "pedida", como sempre).
--
-- pedido_adicional_pix — UM Pix de adicional por mudança do robô (`id` = o id da mudança, que é o da alteração: repetir não
--   gera outro). Situações: `aguardando` (o Pix saiu, o cliente tem até `expira_em`) → `pago` (o gateway confirmou) →
--   `aplicado` (a mudança entrou) ou `pedido_a_loja` (foi ao servidor da loja; ele decide) → `aplicado`. Sem pagar:
--   `expirado`. Pago mas a mudança não entrou (o pedido saiu, a loja recusou): `estornar` → `estornando` (a réplica da
--   API que pegou a vez) → `estornado` (ou `falhou` na 3ª tentativa — caso URGENTE no Atendimento). O pedido cancelado
--   depois devolve também este Pix.
--   Índice único parcial: um Pix de adicional ABERTO por pedido (o robô faz uma mudança por vez).
-- robo_config.cobra_adicional_pix — "O robô cobra no Pix o item posto em pedido já pago" (Atendimento › Ajustes, grupo
--   "Pedido alterado"). Nasce DESLIGADO: o dono liga.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists pedido_adicional_pix (
  id                 uuid primary key,                    -- = o id da mudança do robô (e da alteração)
  tenant_id          uuid not null references empresa(id) on delete cascade,
  unidade_id         uuid,
  pedido_id          uuid not null references pedido_externo(id) on delete cascade,
  telefone           text not null,                       -- o da conversa (para avisar o cliente)
  via                text,                                -- cloud | evolution (a via da conversa)
  descricao          text not null,                       -- "1x Coca lata" (o que o alerta e o cliente leem)
  mudanca            jsonb not null,                      -- a mudança do robô (`MudancaDoRobo`) que entra quando pagar
  valor              numeric(12, 2) not null,             -- a diferença cobrada
  gateway_provider   text,                                -- mercadopago | pagseguro | rede
  gateway_payment_id text,
  copia_cola         text,                                -- o Pix copia-e-cola mandado ao cliente
  situacao           text not null default 'aguardando',
  expira_em          timestamptz not null,
  pago_em            timestamptz,
  aplicado_em        timestamptz,
  erro               text,                                -- o motivo da última falha (sem segredo)
  tentativas         integer not null default 0,          -- as tentativas do estorno
  estorno_id         text,
  criado_em          timestamptz not null default clock_timestamp(),
  atualizado_em      timestamptz not null default clock_timestamp(),
  constraint ck_pedido_adicional_pix_valor check (valor > 0),
  constraint ck_pedido_adicional_pix_situacao check (situacao in
    ('aguardando', 'pago', 'pedido_a_loja', 'aplicado', 'expirado', 'estornar', 'estornando', 'estornado', 'falhou'))
);
create unique index if not exists uq_pedido_adicional_pix_aberto on pedido_adicional_pix (pedido_id)
  where situacao in ('aguardando', 'pago', 'pedido_a_loja');
-- A rotina (de 30 em 30 s, todas as lojas numa consulta) lê só as abertas e as que esperam o estorno.
create index if not exists idx_pedido_adicional_pix_fila on pedido_adicional_pix (atualizado_em)
  where situacao in ('aguardando', 'pago', 'pedido_a_loja', 'estornar', 'estornando');
-- O aviso do gateway chega só com o id do pagamento.
create index if not exists idx_pedido_adicional_pix_pagamento on pedido_adicional_pix (gateway_payment_id)
  where gateway_payment_id is not null;
alter table pedido_adicional_pix enable row level security;

alter table robo_config add column if not exists cobra_adicional_pix boolean not null default false;

-- Conferência (no mesmo Run): a tabela (com RLS), os índices e a coluna.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as ok
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname = 'pedido_adicional_pix'
union all
select 'indice', i.indexname, 'true'
  from pg_indexes i
 where i.schemaname = current_schema()
   and i.indexname in ('uq_pedido_adicional_pix_aberto', 'idx_pedido_adicional_pix_fila', 'idx_pedido_adicional_pix_pagamento')
union all
select 'coluna', 'robo_config.cobra_adicional_pix',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'robo_config'
                  and column_name = 'cobra_adicional_pix' and data_type = 'boolean')::text
 order by 1, 2;
