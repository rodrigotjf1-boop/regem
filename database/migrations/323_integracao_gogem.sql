-- @cloud-only
-- 323_integracao_gogem.sql — o GoGeM (totem) ganha token PRÓPRIO da API de integração (fase 1 da credencial
-- própria do GoGeM; pedido do Hub DMS, D10; plano aprovado pelo dono em 14/10/2026).
--
-- Até aqui a nuvem do GoGeM chamava o Regem com o token de um equipamento `servidor_local` (mig 290): a
-- mesma espécie de credencial do servidor da loja, em texto puro nos dois lados (a fase 0 já a restringiu
-- às cinco rotas dele). Agora o GoGeM é um cliente da API de integração, com um token por loja
-- (`rgm_it_…`, só o resumo guardado), emitido pelo console da distribuição com a autorização do
-- presidente, com escopos, revogação e último uso.
--
-- O QUE ENTRA
--   Três escopos novos nas duas travas de escopo do banco — a do token da loja
--   (`integracao_token_loja`, migs 295/302/315) e a do código de autorização (`integracao_autorizacao`,
--   mig 303), que seguem a MESMA lista do código (`escopos.ts`):
--     • `totem.catalogo.ler`    — GET /sync/catalogo (o catálogo do totem, com preço);
--     • `totem.produtos.pausar` — POST /sync/produtos/pausa;
--     • `totem.vendas.lancar`   — POST /vendas/externa-pdv, /vendas/externa-pdv/falha e /delivery/totem-dinheiro.
--   Os `check` novos CONTÊM os antigos: toda linha que já existe continua valendo.
--
-- O QUE NÃO MUDA
--   Nenhuma tabela, coluna ou gatilho. Os escopos do totem não ligam o carimbador das vendas (o GoGeM
--   lança a venda, não lê vendas): a regra é do código (`ESCOPOS_SEM_CARIMBO`), como no Farol.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as duas tabelas nunca existem lá).
-- ⚠️ Troca as restrições (`drop constraint if exists` + `add constraint`): vai pelo SQL Editor do Supabase,
--    não pelo MCP (que recusa instrução com `drop` — LIC-171). Aplicar na NUVEM ANTES do merge. Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_autorizacao') is null then
    raise exception 'A 323 depende da 295 (integracao_token_loja) e da 303 (integracao_autorizacao): aplique-as antes.';
  end if;
end $$;

alter table integracao_token_loja drop constraint if exists ck_integracao_token_loja_escopos;
alter table integracao_token_loja add constraint ck_integracao_token_loja_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler',
                       'totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar']::text[]
);

alter table integracao_autorizacao drop constraint if exists ck_integracao_autorizacao_escopos;
alter table integracao_autorizacao add constraint ck_integracao_autorizacao_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler',
                       'totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar']::text[]
);

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`. (Restrições procuradas
-- só neste schema: o banco de teste tem outros schemas com os mesmos nomes.)
with ns as (select oid from pg_namespace where nspname = current_schema()),
     token as (
       select pg_get_constraintdef(c.oid) as def from pg_constraint c
        where c.conname = 'ck_integracao_token_loja_escopos' and c.connamespace = (select oid from ns)
     ),
     autorizacao as (
       select pg_get_constraintdef(c.oid) as def from pg_constraint c
        where c.conname = 'ck_integracao_autorizacao_escopos' and c.connamespace = (select oid from ns)
     )
select 'token: aceita os três escopos do totem' as objeto,
       coalesce((select def like '%totem.catalogo.ler%' and def like '%totem.produtos.pausar%' and def like '%totem.vendas.lancar%' from token), false) as ok
union all
select 'token: os escopos de antes continuam aceitos',
       coalesce((select def like '%pedidos.ler%' and def like '%cupons.criar%' and def like '%producao.ler%' from token), false)
union all
select 'autorização: aceita os três escopos do totem',
       coalesce((select def like '%totem.catalogo.ler%' and def like '%totem.produtos.pausar%' and def like '%totem.vendas.lancar%' from autorizacao), false)
union all
select 'autorização: os escopos de antes continuam aceitos',
       coalesce((select def like '%pedidos.ler%' and def like '%cupons.criar%' and def like '%producao.ler%' from autorizacao), false);
