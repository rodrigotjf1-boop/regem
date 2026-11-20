-- @cloud-only
-- 474 · CLUBE DE RECOMPRA — O PRÊMIO SURPRESA (fase A1 do `docs/plano-clube-e-banner.md`; protótipo
-- `mockups/regem-clube-banner.html`, aprovado pelo dono em 20/11/2026). Só NUVEM, como a 471: o clube roda na nuvem; a
-- loja não tem esta tabela.
--
-- O que entra:
--   clube_direito — cada prêmio que um cliente GANHOU: o gatilho (nesta fase, o pedido entregue; depois a reclamação, a
--     classificação do marketing e a campanha), a referência (o pedido, o caso, a campanha) — ÚNICA por empresa e
--     gatilho: a rotina e duas réplicas da API nunca dão o mesmo prêmio duas vezes —, o prêmio com o nome e a descrição
--     de quando ganhou (o catálogo pode mudar depois), a forma de revelar (raspadinha ou roleta), o CUPOM PESSOAL criado
--     para ele (D3 — `cupom` + `cupom_regra`, como o presente do aniversário), o código do link (aleatório, de 128 bits) e
--     quando o cliente revelou. Antes de revelar, o cupom não aparece em "Sua conta › Benefícios" (não estraga a
--     surpresa). O prêmio é definido pela regra quando o cliente ganha: a raspadinha e a roleta só revelam (sem sorteio).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabela nova e vazia; `criado_em` com
-- `clock_timestamp()` (ERR-379: a mesma transação não empata a ordem); o `lock_timeout` desiste em vez de enfileirar.
set local lock_timeout = '5s';

create table if not exists clube_direito (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references empresa(id) on delete cascade,
  cliente_id        uuid,
  chave_telefone    text not null,
  ferramenta        text not null default 'surpresa',
  gatilho           text not null,
  ref               text not null,
  premio_id         uuid,
  premio_nome       text not null,
  premio_descricao  text not null,
  forma             text not null,
  cupom_id          uuid,
  codigo            text not null,
  valido_ate        date not null,
  revelado_em       timestamptz,
  criado_em         timestamptz not null default clock_timestamp()
);
do $$ begin
  alter table clube_direito add constraint ck_clube_direito_valores check (
    ferramenta in ('surpresa', 'album', 'meta')
    and gatilho in ('entregue', 'reclamacao', 'classificacao', 'campanha', 'album', 'meta')
    and forma in ('raspadinha', 'roleta', 'escolha')
    and char_length(codigo) between 16 and 64);
exception when duplicate_object then null; end $$;
create unique index if not exists uq_clube_direito_ref on clube_direito (tenant_id, gatilho, ref);
create unique index if not exists uq_clube_direito_codigo on clube_direito (codigo);
create index if not exists idx_clube_direito_cliente on clube_direito (tenant_id, chave_telefone, criado_em desc);
create index if not exists idx_clube_direito_cupom on clube_direito (cupom_id) where cupom_id is not null;

-- Quem ganhou o quê é dado de cliente: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como a
-- 357 e a 471 (o app usa um papel que atravessa a RLS).
alter table clube_direito enable row level security;

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`.
select 'tabela clube_direito' as objeto,
       to_regclass(current_schema() || '.clube_direito') is not null as ok
union all
select 'um prêmio por gatilho e referência (o índice único)',
       to_regclass(current_schema() || '.uq_clube_direito_ref') is not null
union all
select 'o código do link único',
       to_regclass(current_schema() || '.uq_clube_direito_codigo') is not null
union all
select 'RLS ligada e a regra dos valores',
       coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass(current_schema() || '.clube_direito')), false)
       and exists (select 1 from pg_constraint k where k.conname = 'ck_clube_direito_valores'
                    and k.conrelid = to_regclass(current_schema() || '.clube_direito'));
