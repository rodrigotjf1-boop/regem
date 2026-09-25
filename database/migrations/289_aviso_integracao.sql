-- 289 — FILA DE SAÍDA dos avisos do Regem para os sistemas integrados (o primeiro: o GoGeM).
--
-- ⚠️ NÃO é @cloud-only: o cancelamento da venda do totem acontece no SERVIDOR DA LOJA (e às
--    vezes na nuvem), e o aviso sai da máquina que cancelou.
-- ⚠️ NÃO sincroniza: é fila DESTA máquina — quem gravou é quem envia (sincronizar faria a outra
--    ponta mandar de novo). No `sync-daemon.mjs` ela é FILA_DE_SAIDA: aviso ainda não entregue
--    TRAVA a reinstalação — pedido de estorno não pode sumir num banco apagado.
-- ⚠️ Aplicar na NUVEM ANTES do merge (sem a tabela, o cancelamento de venda do totem segue, mas o
--    aviso não é gravado e o operador é avisado de que o estorno NÃO foi pedido). Idempotente.
--
-- POR QUE EXISTE
--
-- Com a integração GoGeM ativa, o cancelamento de uma venda do totem é feito NO REGEM (decisão
-- do dono, 25/09/2026) — mas quem devolve o dinheiro do cartão/PIX é o GoGeM, o único com as
-- credenciais do Mercado Pago. O GoGeM recebe o aviso em
-- `POST /api/v1/sync/regem/pedido-cancelado` (X-Sync-Token). Até aqui o Regem nunca o chamava:
-- a venda era desfeita e o cliente não recebia o dinheiro de volta.
--
-- O dinheiro do cliente não pode depender de a rede estar boa naquela hora: o aviso é gravado
-- JUNTO com o cancelamento (mesma transação), enviado na hora, e um job reenvia com recuo até
-- o GoGeM confirmar. Um aviso por venda: o índice único em (tenant, destino, tipo, chave) faz o
-- segundo caminho de cancelamento da mesma venda (cupom e hub) não pedir o estorno duas vezes.

create table if not exists aviso_integracao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  destino text not null,                       -- 'gogem'
  tipo text not null,                          -- 'pedido_cancelado'
  chave text not null,                         -- idempotência do aviso (a idempotencyKey do totem)
  corpo jsonb not null,                        -- exatamente o que vai no POST
  referencia_tipo text,                        -- 'comanda' | 'pedido_externo'
  referencia_id uuid,
  -- pendente | enviando | aguardando_integracao | entregue | recusado
  status text not null default 'pendente',
  tentativas integer not null default 0,
  proxima_tentativa_em timestamptz not null default now(),
  ultimo_status_http integer,
  ultima_resposta jsonb,
  ultimo_erro text,
  entregue_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_aviso_integracao_chave
  on aviso_integracao (tenant_id, destino, tipo, chave);

-- A fila do job: só o que ainda tem de sair, na ordem da próxima tentativa.
create index if not exists idx_aviso_integracao_fila
  on aviso_integracao (proxima_tentativa_em)
  where status in ('pendente', 'enviando', 'aguardando_integracao');
