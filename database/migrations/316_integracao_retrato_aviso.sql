-- @cloud-only
-- 316_integracao_retrato_aviso.sql — O cardápio e as fichas passam a AVISAR quem está conectado
-- (pedido do dono em 11/10/2026: "as fichas, ao serem alteradas no Regem, já enviam ao Farol as
-- modificações, quando integrado — em vez de o Farol ficar buscando").
--
-- O Farol lê `GET /integracao/catalogo` e `GET /integracao/fichas` NA HORA (mig 315): não há versão
-- guardada, então o job dos avisos (mig 304) não tinha como saber que o cardápio de uma loja mudou.
-- Esta migration dá esse sinal, sem guardar retrato nenhum:
--
--   1. Gatilhos POR COMANDO (tabela de transição) nas 12 tabelas que as duas leituras tocam anotam
--      "mudou o catálogo / as fichas da empresa X, loja Y" numa FILA só de inserção
--      (`integracao_retrato_mudanca`) — sem trava em linha compartilhada: dois salvamentos de cardápio
--      da mesma empresa (e o envio da loja pelo sincronismo) nunca esperam um pelo outro.
--   2. O job dos avisos (a cada 15 s) esvazia a fila e CARIMBA a marca (`integracao_retrato_marca`,
--      uma linha por empresa × loja × tipo). Só o job escreve a marca, e só depois de a escrita de
--      quem salvou estar confirmada: uma transação longa não consegue gravar hora antiga atrás de um
--      aviso já mandado — que seria o aviso perdido.
--   3. A busca de novidade do job passa a olhar a marca junto das versões publicadas, com a mesma
--      regra de escopo, de loja e de atraso. O aviso continua sendo só gatilho: quem recebe lê as
--      duas rotas com `?versao=`.
--
-- QUEM PAGA: só a empresa com token ATIVO de `catalogo.ler` ou `fichas.ler` (V51: é DESTE escopo que
-- o aviso depende — token de vendas não liga isto, e token do Farol continua sem ligar a cópia das
-- vendas). Tabela de transição vazia sai na primeira linha; empresa não conectada, depois de uma
-- consulta ao índice dos tokens ativos.
--
-- A LOJA: produto, ficha e setor levam a loja da linha (sem loja = da rede = todas); variação, combo,
-- grupo e opção de adicional, a do produto pai; ingrediente, a da ficha pai; categoria, opção
-- reutilizável, insumo e conversão valem para todas. Pai que não se acha (apagado no mesmo comando)
-- vira "todas": aviso a mais não é problema, aviso a menos é.
--
-- O QUE NÃO CONTA: alteração que só mexe em coluna de DINHEIRO ou de estado do estoque, que nenhuma
-- das duas rotas devolve (o produto é regravado quando o estoque acaba; o insumo, quando entra
-- compra). A lista é do que IGNORAR, de propósito: coluna nova que as rotas passem a devolver avisa
-- sem ninguém lembrar de mexer aqui.
--
-- ⚠️ NUNCA PODE FALHAR: uma exceção num gatilho derrubaria o salvamento do cardápio — e, no envio da
--    loja, o lote inteiro. O corpo roda num bloco com `exception when others` (vira AVISO no log do
--    Postgres; a leitura diária de quem está conectado cobre o que escapar) e com `lock_timeout` curto.
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. As duas tabelas não existem lá e não entram
--    no sincronismo (nem nas listas do sync-daemon), como as da 296 e da 304.
-- ⚠️ DEPENDE da 295 (tokens), da 304 (avisos) e da 315 (escopos do Farol). Aplicar na NUVEM ANTES do
--    merge, FORA DO PICO: criar gatilho pede uma trava rápida em cada uma das 12 tabelas — o
--    `lock_timeout` faz a migration desistir (sem mudar nada) em vez de segurar uma venda.
-- Idempotente (if not exists / create or replace / drop trigger if exists).
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_webhook') is null then
    raise exception 'A 316 depende da 295 (integracao_token_loja) e da 304 (integracao_webhook): aplique-as antes.';
  end if;
end $$;

-- ── Fila de mudanças (só inserção; o job dos avisos esvazia) ─────────────────────────────
create table if not exists integracao_retrato_mudanca (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  unidade_id uuid,                                  -- nulo = da rede (vale para todas as lojas)
  recurso    text not null,                         -- 'catalogo' | 'fichas'
  criado_em  timestamptz not null default clock_timestamp(),
  constraint ck_integracao_retrato_mudanca_recurso check (recurso in ('catalogo', 'fichas'))
);

-- ── A marca: até quando cada retrato mudou (uma linha por empresa × loja × tipo) ─────────
create table if not exists integracao_retrato_marca (
  tenant_id     uuid not null,
  recurso       text not null,                      -- 'catalogo' | 'fichas'
  unidade_id    uuid,                               -- nulo = da rede (vale para todas as lojas)
  atualizado_em timestamptz not null default clock_timestamp(),  -- carimbo do JOB (não a hora da escrita)
  constraint ck_integracao_retrato_marca_recurso check (recurso in ('catalogo', 'fichas'))
);
-- Uma linha só por empresa × tipo × loja (a "sem loja" conta como uma loja): é o alvo do `on conflict`
-- do job e o índice da busca de novidade (poucas linhas por empresa).
create unique index if not exists uq_integracao_retrato_marca
  on integracao_retrato_marca (tenant_id, recurso, (coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid)));

-- Fora do alcance da API REST anônima do Supabase (o app usa um papel que atravessa a RLS), como a 296.
alter table integracao_retrato_mudanca enable row level security;
alter table integracao_retrato_marca enable row level security;

-- ── O gatilho (um só, por comando; os argumentos dizem o que cada tabela é) ──────────────
--   argv[0] = o que muda: 'catalogo' | 'fichas' | 'ambos'
--   argv[1] = de onde vem a loja: 'propria' (a linha tem `unidade_id`) | 'rede' (todas) |
--             'produto' | 'grupo' | 'ficha' (a do pai, achado pela coluna de argv[2])
--   argv[2] = a coluna que aponta para o pai
--   argv[3] = colunas que NÃO contam numa alteração, separadas por vírgula
-- As colunas são lidas pelo JSON da linha (`to_jsonb`): a função não cita coluna que alguma das
-- tabelas não tenha (V9), fora `id` e `tenant_id`, que todas têm.
create or replace function integracao_retrato_mudou() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  tipo       text := tg_argv[0];
  modo       text := tg_argv[1];
  chave      text := case tg_argv[1] when 'propria' then 'unidade_id' when 'rede' then null else tg_argv[2] end;
  ignorar    text[] := string_to_array(coalesce(tg_argv[3], ''), ',');
  conectadas uuid[];
  pares      text[];
begin
  begin
    -- Tabela de transição vazia (o UPDATE do INSERT … ON CONFLICT do envio da loja, a FK em cascata
    -- que não apagou nada): sai antes de qualquer consulta.
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas) then return null; end if;
    elsif not exists (select 1 from novas) then
      return null;
    end if;
    select array_agg(distinct t.tenant_id) into conectadas
      from integracao_token_loja t
     where t.revogado_em is null
       and t.escopos && array['catalogo.ler', 'fichas.ler'];
    if conectadas is null then
      return null;
    end if;

    -- "empresa|referência da loja" de cada linha que conta, sem repetir. (Tabela da rede não precisa
    -- do JSON da linha: `chave` nula pula a conversão.)
    if tg_op = 'INSERT' then
      select array_agg(distinct n.tenant_id::text || '|' ||
                       case when chave is null then '' else coalesce(to_jsonb(n) ->> chave, '') end)
        into pares
        from novas n
       where n.tenant_id = any(conectadas);
    elsif tg_op = 'DELETE' then
      select array_agg(distinct a.tenant_id::text || '|' ||
                       case when chave is null then '' else coalesce(to_jsonb(a) ->> chave, '') end)
        into pares
        from antigas a
       where a.tenant_id = any(conectadas);
    else
      -- Alteração: só a linha em que mudou algo fora das colunas ignoradas — e as duas pontas, porque
      -- o produto pode ter trocado de loja (a antiga perde, a nova ganha). A comparação é por
      -- DIFERENÇA DE CONJUNTO (`except`, que usa hash), e não juntando as duas tabelas de transição:
      -- elas não têm estatística, e a junção virava laço dentro de laço — medido em 11/10/2026:
      -- 33 s para alterar 5 mil produtos num comando, contra 0,13 s sem o gatilho.
      with n as (
        select to_jsonb(x) - ignorar as j from novas x where x.tenant_id = any(conectadas)
      ), a as (
        select to_jsonb(x) - ignorar as j from antigas x where x.tenant_id = any(conectadas)
      ), mudou as (
        (select j from n except select j from a)
        union all
        (select j from a except select j from n)
      )
      select array_agg(distinct (j ->> 'tenant_id') || '|' ||
                       case when chave is null then '' else coalesce(j ->> chave, '') end)
        into pares
        from mudou;
    end if;
    if pares is null then
      return null;
    end if;

    insert into integracao_retrato_mudanca (tenant_id, unidade_id, recurso)
    select distinct r.tenant_id, r.unidade_id, t.recurso
      from (
        select split_part(p, '|', 1)::uuid as tenant_id,
               case modo
                 when 'propria' then nullif(split_part(p, '|', 2), '')::uuid
                 when 'produto' then (select pr.unidade_id from produto pr
                                       where pr.id = nullif(split_part(p, '|', 2), '')::uuid)
                 when 'grupo'   then (select pr.unidade_id from complemento_grupo g
                                        join produto pr on pr.id = g.produto_id
                                       where g.id = nullif(split_part(p, '|', 2), '')::uuid)
                 when 'ficha'   then (select f.unidade_id from ficha_tecnica f
                                       where f.id = nullif(split_part(p, '|', 2), '')::uuid)
                 else null
               end as unidade_id
          from unnest(pares) as p
      ) r
     cross join unnest(case tipo when 'ambos' then array['catalogo', 'fichas'] else array[tipo] end) as t(recurso);
  exception when others then
    raise warning 'integracao_retrato: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- ── Os 36 gatilhos (12 tabelas × inserir, alterar, apagar) ───────────────────────────────
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('categoria_produto',  'catalogo', 'rede',    '',                'updated_at'),
      ('setor',              'catalogo', 'propria', '',                'updated_at'),
      ('produto',            'catalogo', 'propria', '',                'updated_at,pausado_estoque,pausa_motivo,preco_venda,preco_custo,preco_promocional'),
      ('produto_variacao',   'catalogo', 'produto', 'produto_id',      'updated_at,preco_venda'),
      ('produto_combo_item', 'catalogo', 'produto', 'combo_produto_id', 'updated_at'),
      ('complemento_grupo',  'catalogo', 'produto', 'produto_id',      'updated_at'),
      ('complemento_opcao',  'catalogo', 'grupo',   'grupo_id',        'updated_at,preco_delta'),
      ('opcao',              'catalogo', 'rede',    '',                'updated_at,preco_custo,esgotado'),
      ('item_estoque',       'ambos',    'rede',    '',                'updated_at,custo_medio'),
      ('ficha_tecnica',      'fichas',   'propria', '',                'updated_at,preco_venda,meta_cmv'),
      ('ficha_ingrediente',  'ambos',    'ficha',   'ficha_id',        'updated_at,custo_unitario'),
      ('item_conversao',     'fichas',   'rede',    '',                '')
    ) as v(tabela, tipo, modo, pai, ignorar)
  loop
    if to_regclass(current_schema() || '.' || r.tabela) is null then
      raise exception 'A 316 esperava a tabela % neste banco.', r.tabela;
    end if;
    execute format('drop trigger if exists trg_integracao_retrato_ins on %I', r.tabela);
    execute format('drop trigger if exists trg_integracao_retrato_upd on %I', r.tabela);
    execute format('drop trigger if exists trg_integracao_retrato_del on %I', r.tabela);
    execute format(
      'create trigger trg_integracao_retrato_ins after insert on %I referencing new table as novas '
      'for each statement execute function integracao_retrato_mudou(%L, %L, %L, %L)',
      r.tabela, r.tipo, r.modo, r.pai, r.ignorar);
    execute format(
      'create trigger trg_integracao_retrato_upd after update on %I referencing old table as antigas new table as novas '
      'for each statement execute function integracao_retrato_mudou(%L, %L, %L, %L)',
      r.tabela, r.tipo, r.modo, r.pai, r.ignorar);
    execute format(
      'create trigger trg_integracao_retrato_del after delete on %I referencing old table as antigas '
      'for each statement execute function integracao_retrato_mudou(%L, %L, %L, %L)',
      r.tabela, r.tipo, r.modo, r.pai, r.ignorar);
  end loop;
end $$;

-- Conferência no MESMO Run: as seis linhas têm de vir com `ok = true`. Só `to_regclass`, `pg_class` e
-- `pg_trigger` do schema atual — nada que leia a definição de índice ou de restrição do banco inteiro
-- (ERR-194).
select 'tabela integracao_retrato_mudanca (fila)' as objeto,
       to_regclass(current_schema() || '.integracao_retrato_mudanca') is not null as ok
union all
select 'tabela integracao_retrato_marca',
       to_regclass(current_schema() || '.integracao_retrato_marca') is not null
union all
select 'índice único da marca (empresa, tipo, loja)',
       to_regclass(current_schema() || '.uq_integracao_retrato_marca') is not null
union all
select 'RLS ligada nas duas tabelas',
       (select count(*) = 2 from pg_class c
         where c.oid in (to_regclass(current_schema() || '.integracao_retrato_mudanca'),
                         to_regclass(current_schema() || '.integracao_retrato_marca'))
           and c.relrowsecurity)
union all
select 'função integracao_retrato_mudou',
       exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = current_schema() and p.proname = 'integracao_retrato_mudou')
union all
select '36 gatilhos (12 tabelas × 3)',
       (select count(*) = 36 from pg_trigger g
          join pg_class c on c.oid = g.tgrelid
          join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and g.tgname like 'trg_integracao_retrato_%' and not g.tgisinternal);
