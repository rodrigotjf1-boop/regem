-- @cloud-only
-- 483_integracao_audiencias.sql — o Liame lê o TAMANHO de cada público do perfil do cliente (F9 parte 1 do
-- `docs/plano-perfil-cliente.md`, §11; plano aprovado pelo dono em 19/11/2026, decisões na recomendada).
--
-- O QUE ENTRA
--   Um escopo novo nas duas travas de escopo — a do token/ligação (`integracao_token_loja`, migs 295/302/315/323/374/398/
--   429) e a do código de autorização (`integracao_autorizacao`, migs 303/323/374/398/429), a MESMA lista de `escopos.ts`:
--     • `clientes.audiencias.ler` — `GET /integracao/clientes/audiencias`: quantos clientes há em cada segmento do perfil
--       (campeões, em risco, pedem no dinheiro no bolso…) e quantos deles aceitaram receber ofertas. SÓ os números: nenhum
--       cliente sai, nem o código; o número de 1 a 4 não se informa (ninguém é reconhecido pela contagem).
--   Os `check` novos CONTÊM os antigos: toda linha que já existe continua valendo (o `add constraint` confere cada linha e
--   recusa o arquivo inteiro se alguma não couber).
--
-- Nenhuma tabela, coluna ou gatilho novo: só as duas travas. Nada em tabela quente (`produto`, `pedido_externo`).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as tabelas da 295 e da 303 nunca existem lá).
-- ⚠️ Troca as restrições (`drop constraint if exists` + `add constraint`): vai pelo SQL EDITOR do Supabase, não pelo MCP
--    (que recusa instrução com `drop` — LIC-171, ERR-225), como a 374, a 398 e a 429. Aplicar na NUVEM ANTES do merge.
--    É uma transação só no SQL Editor; o `lock_timeout` faz a migration desistir sem mudar nada se a tabela estiver presa.
--    Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_autorizacao') is null then
    raise exception 'A 483 depende da 295 (tokens) e da 303 (autorização): aplique-as antes.';
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
                       'catalogo.ifood.ler', 'atendimento.canais.ler',
                       'catalogo.disponibilidade.ler', 'clientes.audiencias.ler']::text[]
);

alter table integracao_autorizacao drop constraint if exists ck_integracao_autorizacao_escopos;
alter table integracao_autorizacao add constraint ck_integracao_autorizacao_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler',
                       'totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar',
                       'catalogo.ifood.ler', 'atendimento.canais.ler',
                       'catalogo.disponibilidade.ler', 'clientes.audiencias.ler']::text[]
);

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`. (Procura só neste schema: o banco de teste tem
-- outros schemas com os mesmos nomes.)
with ns as (select oid from pg_namespace where nspname = current_schema()),
     def as (
       select c.conname, pg_get_constraintdef(c.oid) as d from pg_constraint c
        where c.connamespace = (select oid from ns)
          and c.conname in ('ck_integracao_token_loja_escopos', 'ck_integracao_autorizacao_escopos')
     )
select 'token: aceita clientes.audiencias.ler (e os de antes)' as objeto,
       coalesce((select d like '%clientes.audiencias.ler%' and d like '%catalogo.disponibilidade.ler%' and d like '%pedidos.ler%'
                   from def where conname = 'ck_integracao_token_loja_escopos'), false) as ok
union all
select 'autorização: aceita clientes.audiencias.ler (e os de antes)',
       coalesce((select d like '%clientes.audiencias.ler%' and d like '%catalogo.disponibilidade.ler%' and d like '%pedidos.ler%'
                   from def where conname = 'ck_integracao_autorizacao_escopos'), false);
