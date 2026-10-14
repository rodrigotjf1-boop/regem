-- 319 — Conversões do rendimento na ficha técnica (pedido do dono, 14/10/2026).
--
-- "A conversão só tem no cadastro dos produtos, na ficha técnica não. Uma ficha técnica que produz 10
-- sacos ... ao invés de 10 unidades de sacos seria 1 de 15 quilos, e não tem conversão na hora de um
-- produto usar só uma porção ou pequena parte da ficha." E onde: "logo após escolher o tipo de unidade
-- de medida, logo ali próximo".
--
-- A ficha ganha as conversões do RENDIMENTO, como o produto do estoque tem as dele: [{ "unidadeDe":
-- "saco", "fator": 1.5, "unidadePara": "kg" }] = 1 saco = 1,5 kg. A linha de outra ficha que usa esta
-- como sub-receita escolhe a unidade (saco, kg, grama, porção…) e é GRAVADA na unidade em que esta
-- rende — a mesma regra do produto do estoque, então a venda, a produção e o custo não mudam de conta.
-- Quilo e grama, litro e ml continuam sem cadastro (o sistema converte sozinho).
--
-- NÃO é só nuvem: a ficha sincroniza com o servidor da loja. A coluna nova não entra na lista do que
-- não avisa o Farol (mig 316): mudar a conversão muda como a leitura dele mostra as linhas.
--
-- A venda e a tela leem esta tabela: o `lock_timeout` faz a migration desistir (sem mudar nada) em vez
-- de segurar uma venda. Idempotente; o arquivo não apaga nada.
set local lock_timeout = '5s';

alter table ficha_tecnica
  add column if not exists conversoes jsonb not null default '[]'::jsonb;

comment on column ficha_tecnica.conversoes is
  'Conversões do rendimento: [{unidadeDe, fator, unidadePara}] = 1 unidadeDe vale fator unidadePara. A linha de sub-receita é gravada na unidade do rendimento.';

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.conname = 'ficha_tecnica_conversoes_lista'
       and t.relname = 'ficha_tecnica'
       and n.nspname = current_schema()
  ) then
    alter table ficha_tecnica
      add constraint ficha_tecnica_conversoes_lista check (jsonb_typeof(conversoes) = 'array');
  end if;
end $$;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'ficha_tecnica.conversoes' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'ficha_tecnica'
                  and column_name = 'conversoes' and data_type = 'jsonb' and is_nullable = 'NO') as ok
union all
select 'restrição ficha_tecnica_conversoes_lista',
       exists (select 1
                 from pg_constraint c
                 join pg_class t on t.oid = c.conrelid
                 join pg_namespace n on n.oid = t.relnamespace
                where c.conname = 'ficha_tecnica_conversoes_lista'
                  and t.relname = 'ficha_tecnica'
                  and n.nspname = current_schema());
