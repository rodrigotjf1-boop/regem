-- @cloud-only
-- 492 — MISTER: o que o presidente informa na conversa (versão 7, etapa V7f; `docs/plano-mister.md` § "Versão 7", decisões V7-1,
-- V7-9 e V7-10; protótipo `mockups/regem-mister-v7.html`, aba "Financeiro").
--
-- mister_dado_informado — histórico SÓ DE ACRÉSCIMO do que veio da pessoa, não do banco nem do Regem:
--   tipo             saldo_banco (vale por 7 dias) | folha_mensal | custo_campanha
--   valor_centavos   sempre positivo, com teto
--   data_referencia  o dia a que o valor se refere
--   informado_por    quem tocou em "Guardar" (o presidente)
--   campanha_id      só no custo de campanha. Sem chave estrangeira: a campanha pode ser excluída, e o histórico fica
--   chave            impede gravar duas vezes o mesmo toque
--
-- Corrigir um valor é gravar outra linha: a mais nova vale. Ninguém altera nem apaga uma linha (o gatilho recusa); só sai junto
-- com a empresa. Saldo e folha só o presidente vê, no servidor.
--
-- ⚠️ SÓ NUVEM: a tabela é SO_NUVEM no sync-daemon e o servidor da loja pula o arquivo. Idempotente; não apaga objeto nem dado
-- (LIC-171). RLS ligada e SEM política: fora do alcance da API REST anônima.
set local lock_timeout = '5s';

create table if not exists mister_dado_informado (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references empresa(id) on delete cascade,
  tipo             text not null,
  valor_centavos   bigint not null,
  data_referencia  date not null,
  informado_por    uuid not null,
  campanha_id      uuid,
  chave            text not null,
  criado_em        timestamptz not null default clock_timestamp(),
  constraint ck_mister_dado_tipo check (tipo in ('saldo_banco', 'folha_mensal', 'custo_campanha')),
  constraint ck_mister_dado_valor check (valor_centavos > 0 and valor_centavos <= 9999999999),
  constraint ck_mister_dado_campanha check ((tipo = 'custo_campanha') = (campanha_id is not null))
);
-- O mesmo toque não grava duas vezes.
create unique index if not exists uq_mister_dado_chave on mister_dado_informado (tenant_id, chave);
-- "O último saldo" e "a última folha" da empresa.
create index if not exists idx_mister_dado_ultimo on mister_dado_informado (tenant_id, tipo, data_referencia desc, criado_em desc);
-- "O último custo" de uma campanha.
create index if not exists idx_mister_dado_campanha on mister_dado_informado (tenant_id, campanha_id, criado_em desc) where campanha_id is not null;
alter table mister_dado_informado enable row level security;

comment on table mister_dado_informado is
  'Mister V7f (mig 492): saldo, folha e custo de campanha informados na conversa. Só acréscimo; saldo e folha só o presidente vê.';

-- Só acréscimo. A exclusão em cascata da empresa (dentro do gatilho da chave estrangeira) continua valendo.
create or replace function mister_dado_so_acrescimo() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;
  raise exception 'mister_dado_informado é só de acréscimo: para corrigir, grave outra linha';
end;
$$;

create or replace trigger trg_mister_dado_so_acrescimo
  before update or delete on mister_dado_informado
  for each row execute function mister_dado_so_acrescimo();

-- Conferência (no mesmo Run): a tabela com RLS, as travas, os índices e o gatilho.
select 'tabela' as o_que, c.relname::text as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname = 'mister_dado_informado' and c.relkind = 'r'
union all
select 'trava', conname::text, pg_get_constraintdef(oid)
  from pg_constraint
 where conrelid = 'mister_dado_informado'::regclass and contype = 'c'
union all
select 'indice', indexname::text, indexdef
  from pg_indexes
 where schemaname = current_schema() and tablename = 'mister_dado_informado'
union all
select 'gatilho', tgname::text, pg_get_triggerdef(oid)
  from pg_trigger
 where tgrelid = 'mister_dado_informado'::regclass and not tgisinternal
 order by 1, 2;
