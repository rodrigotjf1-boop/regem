-- @cloud-only
-- 344 · O PEDIDO MONTADO PELO ROBÔ NO WHATSAPP (Fase 5, F3 — pedido do dono de 30/10/2026).
-- Só NUVEM, como a 342: o robô de WhatsApp só existe na nuvem; o pedido, quando registrado (F4), entra pelo MESMO caminho
-- do cardápio online e desce para a loja pelo sync de sempre.
--
-- O que entra:
--   robo_carrinho — o pedido em montagem na conversa: uma linha ABERTA por cliente (pela chave do telefone, que casa o
--     com/sem 55 e o com/sem nono dígito — ERR-134). O carrinho fica no Regem, e não na memória da IA, para que cada
--     passo seja conferido pelo servidor (item, adicional, área, taxa, pedido mínimo, troco) e o resumo que o cliente
--     confirma seja exatamente o que vai ser gravado. `versao` sobe a cada mudança: registrar exige a versão que o
--     cliente viu (F4). `status`: aberto → registrado (com `pedido_id`) ou cancelado (o cliente desistiu ou passou do
--     prazo). Itens: [{ linha, produtoId, variacaoId, complementos: [ids], quantidade, observacao }].
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabela nova e vazia.
set local lock_timeout = '5s';

create table if not exists robo_carrinho (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  telefone        text not null,                       -- como chegou (só dígitos)
  telefone_chave  text not null,                       -- chaveTelefone(): a comparação entre as formas do número
  cliente_nome    text,
  itens           jsonb not null default '[]'::jsonb,
  entrega         jsonb,                               -- { tipo, endereço, bairro, referência, taxa… }
  pagamento       jsonb,                               -- { forma, trocoPara }
  versao          integer not null default 0,
  status          text not null default 'aberto',
  pedido_id       uuid,
  criado_em       timestamptz not null default now(),
  atualizado_em   timestamptz not null default now(),
  constraint ck_robo_carrinho_status check (status in ('aberto', 'registrado', 'cancelado')),
  constraint ck_robo_carrinho_itens check (jsonb_typeof(itens) = 'array')
);

-- Um carrinho ABERTO por cliente da loja: duas mensagens no mesmo instante não abrem dois (o serviço trata o 23505).
create unique index if not exists uq_robo_carrinho_aberto on robo_carrinho (tenant_id, telefone_chave) where status = 'aberto';
create index if not exists ix_robo_carrinho_pedido on robo_carrinho (tenant_id, pedido_id) where pedido_id is not null;

-- Telefone e endereço do cliente: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como a 342
-- (o app usa um papel que atravessa a RLS).
alter table robo_carrinho enable row level security;

-- Conferência no MESMO Run: as cinco linhas têm de vir com `ok = true`.
select 'tabela robo_carrinho' as objeto,
       to_regclass(current_schema() || '.robo_carrinho') is not null as ok
union all
select 'índice único (empresa, chave do telefone) só do aberto',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'robo_carrinho'
                  and indexname = 'uq_robo_carrinho_aberto' and indexdef ilike '%unique%' and indexdef ilike '%aberto%')
union all
select 'RLS ligada em robo_carrinho',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.robo_carrinho')), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true)
-- Tabela nova sem permissão para o papel do app dá 500 "permission denied" (225–227, set/2026): conferir aqui.
union all
select 'regem_app lê e grava robo_carrinho',
       case when not exists (select 1 from pg_roles where rolname = 'regem_app') then true
            else has_table_privilege('regem_app', current_schema() || '.robo_carrinho', 'select, insert, update') end;
