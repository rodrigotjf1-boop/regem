-- @cloud-only
-- 429_integracao_disponibilidade.sql — o RegeMBoard mostra na TV o que acabou no Regem (Hub DMS, F6, plano "Clique
-- RegeMBoard → Regem", decisões R-1 a R-9 nas recomendadas do dono, 15/11/2026; protótipo `clique-regemboard.html`).
-- A porta já dava o catálogo (`catalogo.ler`), mas não se cada produto está à venda AGORA, e o aviso `catalogo.alterado`
-- ignora a pausa de propósito (mig 403: "o aviso ignora o que a porta não devolve").
--
-- O QUE ENTRA
--   1. Um escopo novo nas duas travas de escopo — a do token da loja (`integracao_token_loja`, migs 295/302/315/323/374/
--      398) e a do código de autorização (`integracao_autorizacao`, migs 303/323/374/398), a MESMA lista de `escopos.ts`:
--        • `catalogo.disponibilidade.ler` — no `GET /integracao/catalogo`, o produto e o adicional ganham `disponivel` e
--          `indisponivel_por` (fora do cardápio, esgotado em todas as lojas, esgotado nesta loja). Sem preço.
--      Os `check` novos CONTÊM os antigos: toda linha que já existe continua valendo.
--   2. Um recurso novo nos avisos de retrato (mig 316): `disponibilidade` na fila (`integracao_retrato_mudanca`) e na
--      marca (`integracao_retrato_marca`). O job dos avisos é o mesmo: esvazia a fila, carimba a marca e avisa
--      `disponibilidade.alterada` a quem tem o escopo (`EVENTO_DO_RETRATO`, `webhook-integracao.ts`).
--   3. Os gatilhos que enchem a fila: produto (`pausado_estoque`, o esgotado de todas as lojas), a pausa da loja
--      (`produto_pausa_estoque`: entrar, mudar ou sair) e a opção reutilizável (`esgotado`). A mudança de `ativo` já
--      avisa `catalogo.alterado` (a 316 não a ignora) — e quem lê a disponibilidade também tem `catalogo.ler`.
--
-- O GATILHO (molde da 316): POR COMANDO, com as tabelas de transição; só quando há empresa com token ATIVO deste escopo
-- (V51: é DESTE escopo que o aviso depende); a comparação da alteração é por DIFERENÇA DE CONJUNTO (`except`, hash),
-- nunca juntando as duas tabelas de transição (ERR-224: a junção levava 33 s em 5 mil produtos). Só as colunas que
-- contam entram na comparação. ⚠️ NUNCA PODE FALHAR: o corpo roda num bloco com `exception when others` (vira AVISO no
-- log) e com `lock_timeout` curto — um erro aqui nunca derruba o salvamento do produto nem o lote do sincronismo.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as tabelas da 295, 303 e 316 nunca existem lá).
-- ⚠️ Troca as restrições (`drop constraint if exists` + `add constraint`): vai pelo SQL EDITOR do Supabase, não pelo MCP
--    (que recusa instrução com `drop` — LIC-171, ERR-225), como a 374 e a 398. Aplicar na NUVEM ANTES do merge, FORA DO
--    PICO: criar gatilho pede uma trava rápida em produto, produto_pausa_estoque e opcao — o `lock_timeout` faz a
--    migration desistir (sem mudar nada, é uma transação só no SQL Editor) em vez de segurar uma venda. Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_autorizacao') is null
     or to_regclass(current_schema() || '.integracao_retrato_mudanca') is null
     or to_regclass(current_schema() || '.produto_pausa_estoque') is null then
    raise exception 'A 429 depende da 295 (tokens), da 303 (autorização), da 316 (avisos de retrato) e da 260 (pausa por loja): aplique-as antes.';
  end if;
end $$;

-- ── 1. As travas de escopo ────────────────────────────────────────────────────────────────
alter table integracao_token_loja drop constraint if exists ck_integracao_token_loja_escopos;
alter table integracao_token_loja add constraint ck_integracao_token_loja_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler',
                       'catalogo.ler', 'fichas.ler', 'producao.ler',
                       'totem.catalogo.ler', 'totem.produtos.pausar', 'totem.vendas.lancar',
                       'catalogo.ifood.ler', 'atendimento.canais.ler',
                       'catalogo.disponibilidade.ler']::text[]
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
                       'catalogo.disponibilidade.ler']::text[]
);

-- ── 2. O recurso novo nos avisos de retrato ──────────────────────────────────────────────
alter table integracao_retrato_mudanca drop constraint if exists ck_integracao_retrato_mudanca_recurso;
alter table integracao_retrato_mudanca add constraint ck_integracao_retrato_mudanca_recurso
  check (recurso in ('catalogo', 'fichas', 'disponibilidade'));

alter table integracao_retrato_marca drop constraint if exists ck_integracao_retrato_marca_recurso;
alter table integracao_retrato_marca add constraint ck_integracao_retrato_marca_recurso
  check (recurso in ('catalogo', 'fichas', 'disponibilidade'));

-- ── 3. O gatilho (um só, por comando; os argumentos dizem o que cada tabela é) ────────────
--   argv[0] = de onde vem a loja: 'propria' (a coluna `unidade_id` da linha; nula = da rede = todas) | 'rede' (todas)
--   argv[1] = as colunas que contam numa ALTERAÇÃO, separadas por vírgula (inserir e apagar contam sempre)
create or replace function integracao_disponibilidade_mudou() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  modo       text := tg_argv[0];
  contam     text[] := array['id', 'tenant_id', 'unidade_id'] || string_to_array(coalesce(tg_argv[1], ''), ',');
  conectadas uuid[];
  pares      text[];
begin
  begin
    -- Tabela de transição vazia: sai antes de qualquer consulta.
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas) then return null; end if;
    elsif not exists (select 1 from novas) then
      return null;
    end if;
    select array_agg(distinct t.tenant_id) into conectadas
      from integracao_token_loja t
     where t.revogado_em is null
       and t.escopos @> array['catalogo.disponibilidade.ler'];
    if conectadas is null then
      return null;
    end if;

    if tg_op = 'INSERT' then
      select array_agg(distinct n.tenant_id::text || '|' ||
                       case when modo = 'propria' then coalesce(to_jsonb(n) ->> 'unidade_id', '') else '' end)
        into pares
        from novas n
       where n.tenant_id = any(conectadas);
    elsif tg_op = 'DELETE' then
      select array_agg(distinct a.tenant_id::text || '|' ||
                       case when modo = 'propria' then coalesce(to_jsonb(a) ->> 'unidade_id', '') else '' end)
        into pares
        from antigas a
       where a.tenant_id = any(conectadas);
    else
      -- Alteração: só a linha em que mudou uma coluna que conta — e as duas pontas (a loja pode ter mudado). Diferença
      -- de conjunto sobre o recorte das colunas que contam (ERR-224), nunca junção das tabelas de transição.
      with n as (
        select (select jsonb_object_agg(k, to_jsonb(x) -> k) from unnest(contam) k) as j
          from novas x where x.tenant_id = any(conectadas)
      ), a as (
        select (select jsonb_object_agg(k, to_jsonb(x) -> k) from unnest(contam) k) as j
          from antigas x where x.tenant_id = any(conectadas)
      ), mudou as (
        (select j from n except select j from a)
        union all
        (select j from a except select j from n)
      )
      select array_agg(distinct (j ->> 'tenant_id') || '|' ||
                       case when modo = 'propria' then coalesce(j ->> 'unidade_id', '') else '' end)
        into pares
        from mudou;
    end if;
    if pares is null then
      return null;
    end if;

    insert into integracao_retrato_mudanca (tenant_id, unidade_id, recurso)
    select distinct split_part(p, '|', 1)::uuid, nullif(split_part(p, '|', 2), '')::uuid, 'disponibilidade'
      from unnest(pares) as p;
  exception when others then
    raise warning 'integracao_disponibilidade: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- ── Os gatilhos (sem `drop`: `create or replace trigger`, Postgres 14+; a nuvem é 17, o CI 16) ──
-- Uma transição por gatilho: o Postgres não aceita tabela de transição em gatilho de mais de um evento.
create or replace trigger trg_integracao_disponib_upd
  after update on produto
  referencing old table as antigas new table as novas
  for each statement execute function integracao_disponibilidade_mudou('propria', 'pausado_estoque');

create or replace trigger trg_integracao_disponib_ins
  after insert on produto_pausa_estoque
  referencing new table as novas
  for each statement execute function integracao_disponibilidade_mudou('propria', 'pausado,deleted_at');

create or replace trigger trg_integracao_disponib_upd
  after update on produto_pausa_estoque
  referencing old table as antigas new table as novas
  for each statement execute function integracao_disponibilidade_mudou('propria', 'pausado,deleted_at');

create or replace trigger trg_integracao_disponib_del
  after delete on produto_pausa_estoque
  referencing old table as antigas
  for each statement execute function integracao_disponibilidade_mudou('propria', 'pausado,deleted_at');

create or replace trigger trg_integracao_disponib_upd
  after update on opcao
  referencing old table as antigas new table as novas
  for each statement execute function integracao_disponibilidade_mudou('rede', 'esgotado');

-- Conferência no MESMO Run: as seis linhas têm de vir com `ok = true`. (Procura só neste schema: o banco de teste tem
-- outros schemas com os mesmos nomes.)
with ns as (select oid from pg_namespace where nspname = current_schema()),
     def as (
       select c.conname, pg_get_constraintdef(c.oid) as d from pg_constraint c
        where c.connamespace = (select oid from ns)
          and c.conname in ('ck_integracao_token_loja_escopos', 'ck_integracao_autorizacao_escopos',
                            'ck_integracao_retrato_mudanca_recurso', 'ck_integracao_retrato_marca_recurso')
     )
select 'token: aceita catalogo.disponibilidade.ler (e os de antes)' as objeto,
       coalesce((select d like '%catalogo.disponibilidade.ler%' and d like '%atendimento.canais.ler%' and d like '%pedidos.ler%'
                   from def where conname = 'ck_integracao_token_loja_escopos'), false) as ok
union all
select 'autorização: aceita catalogo.disponibilidade.ler (e os de antes)',
       coalesce((select d like '%catalogo.disponibilidade.ler%' and d like '%atendimento.canais.ler%' and d like '%pedidos.ler%'
                   from def where conname = 'ck_integracao_autorizacao_escopos'), false)
union all
select 'fila e marca dos avisos: aceitam disponibilidade',
       (select count(*) = 2 from def where conname like 'ck_integracao_retrato_%' and d like '%disponibilidade%' and d like '%fichas%')
union all
select 'função integracao_disponibilidade_mudou',
       exists (select 1 from pg_proc where proname = 'integracao_disponibilidade_mudou' and pronamespace = (select oid from ns))
union all
select 'gatilhos: produto, opção e os três da pausa da loja',
       (select count(*) = 5 from pg_trigger g join pg_class t on t.oid = g.tgrelid
         where t.relnamespace = (select oid from ns) and not g.tgisinternal
           and g.tgname like 'trg_integracao_disponib_%')
union all
-- (Os tokens e autorizações que já existem cabem na trava nova: o `add constraint` confere cada linha e recusa o arquivo
-- inteiro se alguma não couber.)
select 'a pausa da loja: os três gatilhos (entrar, mudar e sair)',
       (select count(*) = 3 from pg_trigger g join pg_class t on t.oid = g.tgrelid
         where t.relnamespace = (select oid from ns) and t.relname = 'produto_pausa_estoque' and not g.tgisinternal
           and g.tgname like 'trg_integracao_disponib_%');
