-- @cloud-only
-- 466 · OS CLIQUES NO CARDÁPIO (F4 do `docs/plano-perfil-cliente.md`, §4.3 "o que olha" — aprovada pelo dono em 19/11/2026).
-- Só NUVEM, como o resto do perfil (SO_NUVEM no sync-daemon): o cardápio online mora lá.
--
-- cardapio_interacao — o que o cliente faz no cardápio Regem, por SESSÃO anônima (a mesma do funil — `cardapio_evento`):
--   produto aberto (com o tempo aberto), produto posto no carrinho e busca (o termo e quantos itens achou). Só aparecer na
--   tela não conta. ANÔNIMO por padrão; `cliente_id` só de quem ligou "Recomendações personalizadas" e entrou com o código
--   do WhatsApp — e só daquele momento em diante (nunca o histórico de antes do "sim"; ANPD, Guia de Cookies). Só com o
--   módulo "Perfil do cliente" ligado. APAGADO aos 90 dias pela rotina do perfil (o que a loja vê é a soma, sem pessoa).
--
-- `em` pelo `clock_timestamp()` (V9, ERR-379). RLS ligada e SEM política, como a 459. Sem instrução destrutiva (vai à nuvem
-- pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists cardapio_interacao (
  id          bigint generated always as identity primary key,
  tenant_id   uuid not null references empresa(id) on delete cascade,
  sessao      text not null,
  cliente_id  uuid references cliente(id) on delete cascade,
  tipo        text not null,
  produto_id  uuid,
  ms          integer,
  termo       text,
  resultados  integer,
  em          timestamptz not null default clock_timestamp(),
  constraint cardapio_interacao_tipo_ck check (tipo in ('produto_aberto', 'produto_adicionado', 'busca')),
  constraint cardapio_interacao_termo_ck check (termo is null or char_length(termo) <= 60)
);
create index if not exists ix_cardapio_interacao_tenant_em on cardapio_interacao (tenant_id, em);
create index if not exists ix_cardapio_interacao_cliente on cardapio_interacao (cliente_id, em) where cliente_id is not null;
alter table cardapio_interacao enable row level security;

-- Conferência (no mesmo Run).
select to_regclass(current_schema() || '.cardapio_interacao') is not null as tabela,
       (select count(*) from pg_constraint where conname in ('cardapio_interacao_tipo_ck', 'cardapio_interacao_termo_ck')) as regras;
