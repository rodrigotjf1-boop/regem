-- 401 — Preço na 99 e "está na 99" no produto; preço na 99 e pausa por canal na opção (R3 da Gestão do catálogo, fase
-- F2; protótipo `mockups/regem-conciliacao-ifood.html` aprovado pelo dono em 11/11/2026 — decisões 6, 14 e 15).
--
-- O Regem passa a guardar, como já guarda para o iFood (mig 369):
--   produto.preco_99        — o preço do produto NA 99 (pode ser diferente do preço do Regem e do iFood). Vazio (null) =
--                             o Regem não mexe no preço de lá (o "Exportar catálogo" da 99 segue mandando o preço de venda).
--   produto.na_99           — o lojista diz se o produto está no cardápio da 99. Começa desmarcado.
--   opcao.preco_99          — o preço do complemento na 99 (decisão 15): um por opção, como o do iFood. Usado na fase F3.
--   opcao.canais_pausados   — a pausa da opção por canal (decisão 14): a lista dos canais em que ela está pausada
--                             ('ifood', '99food'), como `produto.canais_pausados`. Vazia = como hoje (o `esgotado` vale
--                             para tudo). Usada na fase F3; nesta fase ninguém grava nela.
-- A ligação com a 99 é pelo código PDV (`app_item_id` = `produto.codigo`, o mesmo do "Exportar catálogo" da 99).
-- Nada é enviado à 99 por esta migration (o envio item a item é a fila da mig 402, só da nuvem).
--
-- Nasce DESLIGADO: o servidor só grava os campos da 99 com o direito `precos_na_99` ligado na empresa (`entitlement`,
-- sem linha = desligado), e a distribuição só o liga com TODOS os servidores de loja da empresa na versão que traz esta
-- migration — o sincronismo da loja só regrava a linha que chega ESTRITAMENTE mais nova, então um produto puxado antes do
-- `.zip` (sem a coluna) ficaria com o preço vazio na loja e o subiria por cima do da nuvem na próxima edição (o mesmo
-- caso da 369). Com o direito desligado até lá, os dois lados ficam vazios e não há o que perder.
--
-- Roda na NUVEM e no SERVIDOR DA LOJA (as duas tabelas sincronizam nos dois sentidos; o Drizzle nomeia toda coluna do
-- schema no `select()` — sem a coluna, 42703 em toda tela, ERR-029). Aplicar na nuvem ANTES do merge (V9e).
-- Coluna com valor padrão constante não reescreve a tabela (Postgres 11+). Sem `drop`. Idempotente.
set local lock_timeout = '5s';

alter table produto add column if not exists preco_99 numeric(12, 2);
alter table produto add column if not exists na_99 boolean not null default false;
alter table opcao add column if not exists preco_99 numeric(12, 2);
alter table opcao add column if not exists canais_pausados jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_produto_preco_99'
                    and conrelid = (current_schema() || '.produto')::regclass) then
    alter table produto add constraint ck_produto_preco_99 check (preco_99 is null or preco_99 >= 0);
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_opcao_preco_99'
                    and conrelid = (current_schema() || '.opcao')::regclass) then
    alter table opcao add constraint ck_opcao_preco_99 check (preco_99 is null or preco_99 >= 0);
  end if;
end $$;

-- Conferência (no mesmo Run): as quatro colunas e as duas travas — 6 linhas, todas `ok = true`.
select 'produto.preco_99 numeric(12,2)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'produto' and column_name = 'preco_99'
                  and data_type = 'numeric' and numeric_precision = 12 and numeric_scale = 2) as ok
union all
select 'produto.na_99 boolean not null default false',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'produto' and column_name = 'na_99'
                  and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false')
union all
select 'opcao.preco_99 numeric(12,2)',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'opcao' and column_name = 'preco_99'
                  and data_type = 'numeric' and numeric_precision = 12 and numeric_scale = 2)
union all
select 'opcao.canais_pausados jsonb not null',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'opcao' and column_name = 'canais_pausados'
                  and data_type = 'jsonb' and is_nullable = 'NO')
union all
select 'ck_produto_preco_99',
       exists (select 1 from pg_constraint where conname = 'ck_produto_preco_99'
                  and conrelid = (current_schema() || '.produto')::regclass)
union all
select 'ck_opcao_preco_99',
       exists (select 1 from pg_constraint where conname = 'ck_opcao_preco_99'
                  and conrelid = (current_schema() || '.opcao')::regclass);
