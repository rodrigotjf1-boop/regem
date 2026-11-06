-- @cloud-only
-- 374_integracao_orzuni_catalogo_ifood.sql — o Orzuni (cardápio do iFood) lê o catálogo da loja COM o preço do iFood
-- pela porta de integração (pedido do dono, 06/11/2026: o Orzuni importa do Regem o que falta no iFood).
--
-- O caminho que a sessão do Orzuni tinha pensado (o `GET /sync/catalogo` com `X-Sync-Token`) não serve: a rota é do
-- totem (só a credencial do GoGeM passa) e o `X-Sync-Token` é a credencial do SERVIDOR DA LOJA — a que abriria o
-- sincronismo inteiro da empresa. O Orzuni entra como os outros produtos da DMS: um acesso por loja na API de
-- integração (`rgm_it_…` do console, trocado pela ligação do DMS ID), só leitura.
--
-- O QUE ENTRA
--   Um escopo novo nas duas travas de escopo do banco — a do token da loja (`integracao_token_loja`, migs
--   295/302/315/323) e a do código de autorização (`integracao_autorizacao`, migs 303/323), que seguem a MESMA lista
--   do código (`escopos.ts`):
--     • `catalogo.ifood.ler` — junto de `catalogo.ler`, o `GET /integracao/catalogo` traz `preco_ifood_centavos` e
--       `no_ifood` no produto e `preco_ifood_centavos` na opção (colunas da mig 369). Sozinho não abre rota nenhuma.
--   Os `check` novos CONTÊM os antigos: toda linha que já existe continua valendo.
--
-- O QUE NÃO MUDA
--   Nenhuma tabela, coluna ou gatilho. O escopo é de leitura na hora: não liga o carimbador das vendas (a regra é do
--   código, `ESCOPOS_SEM_CARIMBO`, como no Farol e no GoGeM).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as duas tabelas nunca existem lá).
-- ⚠️ Troca as restrições (`drop constraint if exists` + `add constraint`): vai pelo SQL Editor do Supabase, não pelo
--    MCP (que recusa instrução com `drop` — LIC-171). Aplicar na NUVEM ANTES do merge. Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_autorizacao') is null then
    raise exception 'A 374 depende da 295 (integracao_token_loja) e da 303 (integracao_autorizacao): aplique-as antes.';
  end if;
end $$;

alter table integracao_token_loja drop constraint if exists ck_integracao_token_loja_escopos;
alter table integracao_token_loja add constraint ck_integracao_token_loja_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler',
                       'totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar',
                       'catalogo.ifood.ler']::text[]
);

alter table integracao_autorizacao drop constraint if exists ck_integracao_autorizacao_escopos;
alter table integracao_autorizacao add constraint ck_integracao_autorizacao_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler',
                       'totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar',
                       'catalogo.ifood.ler']::text[]
);

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`. (Restrições procuradas só neste schema: o
-- banco de teste tem outros schemas com os mesmos nomes.)
with ns as (select oid from pg_namespace where nspname = current_schema()),
     token as (
       select pg_get_constraintdef(c.oid) as def from pg_constraint c
        where c.conname = 'ck_integracao_token_loja_escopos' and c.connamespace = (select oid from ns)
     ),
     autorizacao as (
       select pg_get_constraintdef(c.oid) as def from pg_constraint c
        where c.conname = 'ck_integracao_autorizacao_escopos' and c.connamespace = (select oid from ns)
     )
select 'token: aceita o escopo do iFood' as objeto,
       coalesce((select def like '%catalogo.ifood.ler%' from token), false) as ok
union all
select 'token: os escopos de antes continuam aceitos',
       coalesce((select def like '%pedidos.ler%' and def like '%cupons.criar%' and def like '%producao.ler%'
                        and def like '%totem.vendas.lancar%' from token), false)
union all
select 'autorização: aceita o escopo do iFood',
       coalesce((select def like '%catalogo.ifood.ler%' from autorizacao), false)
union all
select 'autorização: os escopos de antes continuam aceitos',
       coalesce((select def like '%pedidos.ler%' and def like '%cupons.criar%' and def like '%producao.ler%'
                        and def like '%totem.vendas.lancar%' from autorizacao), false);
