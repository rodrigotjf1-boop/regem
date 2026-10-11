-- @cloud-only
-- 315_integracao_farol.sql — API de integração para o FAROL (auditoria operacional por câmera, da
-- DMS): o Farol lê o catálogo, as fichas técnicas e a fila de produção de cada loja que o
-- presidente autorizar (decisões do dono, 10/10/2026 — ver docs/integracao-farol.md). O Farol só LÊ.
--
-- O QUE ENTRA
--   Três escopos novos nas duas travas de escopo do banco — a do token da loja
--   (`integracao_token_loja`, mig 295/302) e a do código de autorização (`integracao_autorizacao`,
--   mig 303):
--     • `catalogo.ler`  — produtos, variações, combos e adicionais, sem preço;
--     • `fichas.ler`    — fichas técnicas e ingredientes, sem custo;
--     • `producao.ler`  — a fila de produção (a rota entra no PR seguinte; o escopo já fica aceito
--                         para a loja autorizar uma vez só).
--   Os `check` novos CONTÊM os antigos: toda linha que já existe continua valendo.
--
-- O QUE NÃO MUDA
--   Nenhuma tabela, coluna ou gatilho. Os gatilhos das vendas (296, 298, 299) seguem como estão:
--   eles anotam a mudança de toda empresa com token ativo, e é o carimbador (código, não banco)
--   que deixa de fora a empresa cujo único acesso é de leitura na hora — o Farol não lê vendas e
--   não pode ligar a cópia delas.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as duas tabelas nunca existem lá).
-- ⚠️ DEPENDE da 295 e da 303. Aplicar na NUVEM ANTES do merge. Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_autorizacao') is null then
    raise exception 'A 315 depende da 295 (integracao_token_loja) e da 303 (integracao_autorizacao): aplique-as antes.';
  end if;
end $$;

alter table integracao_token_loja drop constraint if exists ck_integracao_token_loja_escopos;
alter table integracao_token_loja add constraint ck_integracao_token_loja_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler']::text[]
);

alter table integracao_autorizacao drop constraint if exists ck_integracao_autorizacao_escopos;
alter table integracao_autorizacao add constraint ck_integracao_autorizacao_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler']::text[]
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
select 'token: aceita os três escopos do Farol' as objeto,
       coalesce((select def like '%catalogo.ler%' and def like '%fichas.ler%' and def like '%producao.ler%' from token), false) as ok
union all
select 'token: os escopos de antes continuam aceitos',
       coalesce((select def like '%pedidos.ler%' and def like '%cupons.criar%' and def like '%vendas.99food.ler%' from token), false)
union all
select 'autorização: aceita os três escopos do Farol',
       coalesce((select def like '%catalogo.ler%' and def like '%fichas.ler%' and def like '%producao.ler%' from autorizacao), false)
union all
select 'autorização: os escopos de antes continuam aceitos',
       coalesce((select def like '%pedidos.ler%' and def like '%cupons.criar%' and def like '%vendas.99food.ler%' from autorizacao), false);
