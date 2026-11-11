-- @cloud-only
-- 398_integracao_canais_atendimento.sql — o Liame pergunta ao Regem quais canais da Meta a Central de atendimento atende
-- (pedido da sessão do Liame, Z12 / D-A6-107, aprovado pelo dono em 11/11/2026: "identificar se usuario ativar no regem
-- fica desativado no liame"). O Liame liga o Direct do Instagram só para quem usa o Liame SEM o Regem; quando a empresa
-- conecta o Instagram ou o Messenger à Central do Regem, o Direct do Liame desliga sozinho naquela conta — para o cliente
-- não receber duas respostas.
--
-- O QUE ENTRA
--   Um escopo novo nas duas travas de escopo do banco — a do token da loja (`integracao_token_loja`, migs
--   295/302/315/323/374) e a do código de autorização (`integracao_autorizacao`, migs 303/323/374), que seguem a MESMA
--   lista do código (`escopos.ts`):
--     • `atendimento.canais.ler` — o `GET /integracao/atendimento/canais`: as contas do Instagram (`instagram_conta`,
--       mig 377: o id e o @) e as páginas do Facebook (`messenger_conta`, mig 386: o id) conectadas à Central da empresa.
--       Nunca o acesso (token), nem mensagem, nem dado de cliente.
--   Os `check` novos CONTÊM os antigos: toda linha que já existe continua valendo.
--
-- O QUE NÃO MUDA
--   Nenhuma tabela, coluna ou gatilho. O escopo é de leitura na hora: não liga o carimbador das vendas (a regra é do
--   código, `ESCOPOS_SEM_CARIMBO`, como no Farol, no GoGeM e no Orzuni).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as tabelas nunca existem lá).
-- ⚠️ Troca as restrições (`drop constraint if exists` + `add constraint`): vai pelo SQL Editor do Supabase, não pelo
--    MCP (que recusa instrução com `drop` — LIC-171), como a 374. Aplicar na NUVEM ANTES do merge. Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_autorizacao') is null then
    raise exception 'A 398 depende da 295 (integracao_token_loja) e da 303 (integracao_autorizacao): aplique-as antes.';
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
                       'catalogo.ifood.ler', 'atendimento.canais.ler']::text[]
);

alter table integracao_autorizacao drop constraint if exists ck_integracao_autorizacao_escopos;
alter table integracao_autorizacao add constraint ck_integracao_autorizacao_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler',
                       'totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar',
                       'catalogo.ifood.ler', 'atendimento.canais.ler']::text[]
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
select 'token: aceita o escopo dos canais da Central' as objeto,
       coalesce((select def like '%atendimento.canais.ler%' from token), false) as ok
union all
select 'token: os escopos de antes continuam aceitos',
       coalesce((select def like '%pedidos.ler%' and def like '%cupons.criar%' and def like '%producao.ler%'
                        and def like '%totem.vendas.lancar%' and def like '%catalogo.ifood.ler%' from token), false)
union all
select 'autorização: aceita o escopo dos canais da Central',
       coalesce((select def like '%atendimento.canais.ler%' from autorizacao), false)
union all
select 'autorização: os escopos de antes continuam aceitos',
       coalesce((select def like '%pedidos.ler%' and def like '%cupons.criar%' and def like '%producao.ler%'
                        and def like '%totem.vendas.lancar%' and def like '%catalogo.ifood.ler%' from autorizacao), false);
