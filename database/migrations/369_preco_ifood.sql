-- 369 — Preço no iFood e "está no cardápio do iFood" no cadastro (R1 da integração com o Orzuni; pedido do dono,
-- 04–05/11/2026).
--
-- O Regem passa a guardar, ao lado do preço de venda dele:
--   produto.preco_ifood — o preço do produto NO iFood (pode ser diferente do preço do Regem). Vazio (null) = o Regem
--                         não mexe no preço do iFood (regra do dono: preço iFood vazio não é enviado).
--   produto.no_ifood    — o lojista diz se o produto está no cardápio do iFood (há lojas com cadastros diferentes nos
--                         dois). Começa desmarcado; a conciliação (R3) marca o que casar pelo código PDV.
--   opcao.preco_ifood   — o preço do complemento no iFood: UM preço por opção do catálogo, isto é, por código PDV
--                         (decisão do dono, 05/11: a ligação com o iFood é pelo código; nenhuma opção da loja tem
--                         preço diferente entre etapas).
-- A ligação com o iFood é pelo código PDV que já existe: `produto.codigo` (mig 331) e `opcao.codigo_pdv`.
-- Nada é enviado ao iFood por esta migration nem pelo código que a acompanha: o envio é o R2.
--
-- Nasce DESLIGADO: o servidor só grava estes campos com o direito `ifood_pelo_orzuni` ligado na empresa
-- (`entitlement`, sem linha = desligado). Ligar SÓ numa empresa cujos servidores de loja já estão na versão que traz
-- esta migration: o sincronismo da loja só regrava a linha que chega ESTRITAMENTE mais nova, então um produto puxado
-- antes do `.zip` (sem a coluna) ficaria com o preço vazio na loja e o subiria por cima do da nuvem na próxima edição.
-- Com o direito desligado até lá, os dois lados ficam vazios e não há o que perder.
--
-- Roda na NUVEM e no SERVIDOR DA LOJA (as duas tabelas sincronizam nos dois sentidos; o Drizzle nomeia toda coluna do
-- schema no `select()` — sem a coluna, 42703 em toda tela, ERR-029). Aplicar na nuvem ANTES do merge (V9e).
-- Coluna com valor padrão constante não reescreve a tabela (Postgres 11+). Idempotente.
set local lock_timeout = '5s';

alter table produto add column if not exists preco_ifood numeric(12, 2);
alter table produto add column if not exists no_ifood boolean not null default false;
alter table opcao add column if not exists preco_ifood numeric(12, 2);

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_produto_preco_ifood'
                    and conrelid = (current_schema() || '.produto')::regclass) then
    alter table produto add constraint ck_produto_preco_ifood check (preco_ifood is null or preco_ifood >= 0);
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_opcao_preco_ifood'
                    and conrelid = (current_schema() || '.opcao')::regclass) then
    alter table opcao add constraint ck_opcao_preco_ifood check (preco_ifood is null or preco_ifood >= 0);
  end if;
end $$;

-- Conferência (no mesmo Run): as três colunas e as duas travas.
select table_name, column_name, data_type, numeric_precision, numeric_scale, is_nullable, column_default
  from information_schema.columns
 where table_schema = current_schema()
   and ((table_name = 'produto' and column_name in ('preco_ifood', 'no_ifood'))
     or (table_name = 'opcao' and column_name = 'preco_ifood'))
 order by table_name, column_name;
