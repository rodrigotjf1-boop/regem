-- 317 — Embalagem do BALCÃO na ficha técnica (pedido do dono, 12/10/2026).
--
-- A ficha já tinha a linha "só delivery" (mig 147): embalagem e outros custos que só entram no pedido
-- externo. Faltava o par dela: a loja que embala também no balcão, com uma embalagem DIFERENTE da do
-- delivery. `somente_balcao` marca a linha que só entra na venda de balcão, mesa e totem.
--
-- A escolha "uso a mesma embalagem no balcão e no delivery" é da empresa inteira e NÃO precisa de
-- coluna: fica em `entitlement` (modulo = 'ficha_mesma_embalagem'), que já existe e já sincroniza
-- com o servidor da loja. Sem registro = desligada = a conta de sempre.
--
-- NÃO é só nuvem: a venda de balcão baixa o estoque no servidor da loja. Sem efeito no que já existe:
-- a coluna nasce `false` em todas as linhas (acréscimo só de catálogo, sem regravar a tabela).
--
-- A venda lê esta tabela a cada item: a trava do `alter` dura um instante, e o `lock_timeout` faz a
-- migration desistir (sem mudar nada) em vez de segurar uma venda. Idempotente; o arquivo não apaga nada.
set local lock_timeout = '5s';

alter table ficha_ingrediente
  add column if not exists somente_balcao boolean not null default false;

comment on column ficha_ingrediente.somente_balcao is
  'Linha só contabilizada na venda de balcão, mesa e totem (embalagem do balcão). Nunca junto com somente_delivery.';

-- A linha é de um canal só. (O serviço recusa antes, com 400; isto guarda os outros caminhos.)
do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.conname = 'ficha_ingrediente_um_canal_so'
       and t.relname = 'ficha_ingrediente'
       and n.nspname = current_schema()
  ) then
    alter table ficha_ingrediente
      add constraint ficha_ingrediente_um_canal_so check (not (somente_delivery and somente_balcao));
  end if;
end $$;

-- Conferência no MESMO Run: as três linhas têm de vir com `ok = true`.
select 'ficha_ingrediente.somente_balcao (boolean, obrigatória, nasce false)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'ficha_ingrediente'
                  and column_name = 'somente_balcao' and data_type = 'boolean' and is_nullable = 'NO'
                  and column_default = 'false') as ok
union all
select 'restrição ficha_ingrediente_um_canal_so',
       exists (select 1 from pg_constraint c
                 join pg_class t on t.oid = c.conrelid
                 join pg_namespace n on n.oid = t.relnamespace
                where c.conname = 'ficha_ingrediente_um_canal_so' and t.relname = 'ficha_ingrediente'
                  and n.nspname = current_schema() and c.contype = 'c' and c.convalidated)
union all
select 'nenhuma linha já marcada como embalagem do balcão',
       not exists (select 1 from ficha_ingrediente where somente_balcao);
