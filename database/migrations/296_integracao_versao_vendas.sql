-- @cloud-only
-- 296_integracao_versao_vendas.sql — Versão e cursor das VENDAS lidas pela API de integração
-- (trilha C, C1c — PR2: `GET /api/v1/integracao/pedidos` e `/clientes/anonimizados`).
--
-- POR QUE UMA TABELA DE VERSÕES (e não o `updated_at` do pedido)
-- O `updated_at` de `pedido_externo`/`comanda` chega com a hora da MÁQUINA DA LOJA: o push do
-- sync mantém o carimbo do servidor local (mig 259). Uma venda que sobe atrasada (loja sem
-- internet por uma hora) teria `updated_at` velho e ficaria ATRÁS do cursor de quem já leu.
-- O cursor da integração é carimbado aqui, na nuvem, DEPOIS que a venda foi gravada de vez.
--
-- COMO FUNCIONA
--   1. Gatilhos POR COMANDO (tabela de transição, nunca linha a linha) em pedido_externo,
--      comanda e comanda_item anotam "este recurso mudou" numa FILA só de inserção
--      (`integracao_mudanca`) — sem trava em linha compartilhada, então a venda e o push da
--      loja nunca esperam por eles. Só anotam para empresa CONECTADA (token ativo, mig 295):
--      tabela de transição vazia sai na primeira linha; senão, uma consulta ao índice parcial dos
--      tokens ativos e, com a empresa fora da lista, uma passada pela transição, sem gravar nada.
--      Medido (lote de 5 mil linhas no formato do push): empresa não conectada ≤ 26 ms por lote;
--      conectada ~20–40 µs por linha. O gatilho de `cliente` anota só a EXCLUSÃO (aviso de
--      cliente anonimizado).
--   2. O carimbador (job da nuvem, a cada 5 s) consome a fila, monta a venda como a API a
--      devolve (a mesma fórmula do Painel, `common/faturamento.ts`), compara com a última
--      publicada e, se mudou, grava a FOTO, sobe a `versao` e carimba `atualizado_em`.
--   3. A API lê só esta tabela (índice + foto), com atraso de segurança sobre o carimbo.
--
-- ⚠️ NUNCA PODE FALHAR: uma exceção num gatilho derrubaria a venda — e, no push da loja, o
--    lote inteiro, que o servidor local reenviaria para sempre. O corpo roda num bloco com
--    `exception when others` (vira AVISO no log do Postgres; a reconciliação diária cobre o
--    que escapar) e com `lock_timeout` curto.
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. As tabelas não existem lá e não
--    entram no sincronismo (nem nas listas do sync-daemon); os gatilhos só existem aqui.
-- ⚠️ DEPENDE da 295 (tokens por loja). Aplicar na NUVEM ANTES do merge, fora do pico: criar
--    gatilho pede uma trava rápida em pedido_externo/comanda/comanda_item/cliente — o
--    `lock_timeout` faz a migration desistir (sem mudar nada) em vez de segurar as vendas.
-- ⚠️ Sem `sequence`: a versão é contador por recurso (nenhuma migration do projeto usa
--    sequence; o papel do app pode não ter USAGE numa nova).
-- Idempotente (if not exists / create or replace / drop trigger if exists).
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null then
    raise exception 'A 296 depende da 295 (integracao_token_loja): aplique a 295 antes.';
  end if;
end $$;

-- ── Fila de mudanças (só inserção; o carimbador consome e apaga) ─────────────────────────
create table if not exists integracao_mudanca (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null,
  recurso    text not null,                        -- 'pedido' | 'comanda' | 'cliente'
  recurso_id uuid not null,
  carga      boolean not null default false,       -- carga inicial / reconciliação: vai depois
  criado_em  timestamptz not null default clock_timestamp(),
  constraint ck_integracao_mudanca_recurso check (recurso in ('pedido', 'comanda', 'cliente'))
);
create index if not exists idx_integracao_mudanca_fila
  on integracao_mudanca (carga, criado_em, id);

-- ── Versão publicada de cada recurso (uma linha por venda / cliente anonimizado) ─────────
create table if not exists integracao_versao (
  recurso       text not null,                     -- 'venda' | 'cliente'
  recurso_id    uuid not null,                     -- id do pedido_externo, da comanda ou do cliente
  tenant_id     uuid not null,
  fonte         text not null,                     -- 'pedido_externo' | 'comanda' | 'cliente'
  unidade_id    uuid,                              -- loja da venda publicada (nulo = sem loja)
  versao        bigint,                            -- só cresce; nulo = nunca publicada
  pendente      boolean not null default true,     -- mudou e o carimbador ainda não olhou
  mudou_em      timestamptz not null default clock_timestamp(),
  atualizado_em timestamptz,                       -- carimbo do cursor (nulo = nunca publicada)
  situacao      text,                              -- venda: confirmado | cancelado | removido
  confirmado_em timestamptz,                       -- filtro `confirmados_desde`
  removido_em   timestamptz,                       -- cliente: quando foi anonimizado
  foto          jsonb,                             -- o que a API devolve (sem custo e sem telefone)
  erro_em       timestamptz,                       -- a montagem desta venda falhou (motivo em `erro`)
  erro          text,
  primary key (recurso, recurso_id),
  constraint ck_integracao_versao_fonte check (
    (recurso = 'venda' and fonte in ('pedido_externo', 'comanda'))
    or (recurso = 'cliente' and fonte = 'cliente')
  ),
  constraint ck_integracao_versao_situacao check (
    situacao is null or situacao in ('confirmado', 'cancelado', 'removido')
  )
);
-- Leitura com cursor: empresa com UMA loja (sem filtro de loja) e clientes anonimizados.
create index if not exists idx_integracao_versao_leitura
  on integracao_versao (tenant_id, recurso, atualizado_em, recurso_id)
  where atualizado_em is not null;
-- Leitura com cursor: empresa com várias lojas (a loja do token, estrita).
create index if not exists idx_integracao_versao_leitura_loja
  on integracao_versao (tenant_id, recurso, unidade_id, atualizado_em, recurso_id)
  where atualizado_em is not null;
-- Carimbador: o que mudou e ainda não foi olhado.
create index if not exists idx_integracao_versao_pendente
  on integracao_versao (mudou_em)
  where pendente;

-- ── Carga inicial (90 dias) por empresa: feita depois de cada token novo ─────────────────
create table if not exists integracao_carga (
  tenant_id uuid primary key,
  feita_em  timestamptz not null
);

-- Dado de venda: fora do alcance da API REST anônima (o app usa um papel que atravessa a RLS).
alter table integracao_mudanca enable row level security;
alter table integracao_versao enable row level security;
alter table integracao_carga enable row level security;

-- ── Gatilhos (por comando, com tabela de transição) ──────────────────────────────────────
-- Todos começam pela lista das empresas CONECTADAS (token ativo; o índice parcial da 295 —
-- poucas linhas). Nenhuma empresa conectada → sai na hora. Empresa do comando fora da lista → uma
-- passada barata pela tabela de transição e sai. Só a empresa conectada paga a anotação.
--
-- pedido_externo: anota o pedido e a(s) comanda(s) ligada(s) — a antiga e a nova, porque a
-- comanda deixa (ou volta a) ser venda de balcão quando o vínculo muda. Update só conta se
-- mudou coluna que a API devolve (entregador, rastreio, impressão… não geram versão).
create or replace function integracao_mudou_pedido() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    -- Tabela de transição vazia (o UPDATE do INSERT … ON CONFLICT do push, a FK em cascata que
    -- não apagou nada): sai antes de qualquer consulta.
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas) then return null; end if;
    elsif not exists (select 1 from novas) then
      return null;
    end if;
    select array_agg(distinct t.tenant_id) into conectadas
      from integracao_token_loja t where t.revogado_em is null;
    if conectadas is null then
      return null;
    end if;
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas a where a.tenant_id = any(conectadas)) then
        return null;
      end if;
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select a.tenant_id, 'pedido', a.id from antigas a where a.tenant_id = any(conectadas)
      union all
      select a.tenant_id, 'comanda', a.comanda_id from antigas a
       where a.comanda_id is not null and a.tenant_id = any(conectadas);
    elsif tg_op = 'INSERT' then
      if not exists (select 1 from novas n where n.tenant_id = any(conectadas)) then
        return null;
      end if;
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select n.tenant_id, 'pedido', n.id from novas n where n.tenant_id = any(conectadas)
      union all
      select n.tenant_id, 'comanda', n.comanda_id from novas n
       where n.comanda_id is not null and n.tenant_id = any(conectadas);
    else
      if not exists (select 1 from novas n where n.tenant_id = any(conectadas)) then
        return null;
      end if;
      with mudou as materialized (
        select n.tenant_id, n.id, n.comanda_id as nova, a.comanda_id as antiga
          from novas n
          join antigas a on a.id = n.id
         where n.tenant_id = any(conectadas)
           and (n.status, n.confirmado_em, n.cancelado_em, n.criado_em, n.pronto_em, n.despachado_em,
                n.entregue_em, n.concluido_em, n.valor_bruto, n.total, n.desconto_loja, n.descontos,
                n.taxa_entrega, n.taxa_entrega_dono, n.taxas_extras_detalhe, n.cupom, n.cliente_id,
                n.comanda_id, n.unidade_id, n.itens, n.canal)
               is distinct from
               (a.status, a.confirmado_em, a.cancelado_em, a.criado_em, a.pronto_em, a.despachado_em,
                a.entregue_em, a.concluido_em, a.valor_bruto, a.total, a.desconto_loja, a.descontos,
                a.taxa_entrega, a.taxa_entrega_dono, a.taxas_extras_detalhe, a.cupom, a.cliente_id,
                a.comanda_id, a.unidade_id, a.itens, a.canal)
      )
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select tenant_id, 'pedido', id from mudou
      union all
      select tenant_id, 'comanda', nova from mudou where nova is not null
      union all
      select tenant_id, 'comanda', antiga from mudou where antiga is not null and antiga is distinct from nova;
    end if;
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- comanda: a própria comanda (a venda de balcão/mesa/totem e a "sombra" do pedido ligado).
create or replace function integracao_mudou_comanda() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    -- Tabela de transição vazia (o UPDATE do INSERT … ON CONFLICT do push, a FK em cascata que
    -- não apagou nada): sai antes de qualquer consulta.
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas) then return null; end if;
    elsif not exists (select 1 from novas) then
      return null;
    end if;
    select array_agg(distinct t.tenant_id) into conectadas
      from integracao_token_loja t where t.revogado_em is null;
    if conectadas is null then
      return null;
    end if;
    if tg_op = 'DELETE' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select a.tenant_id, 'comanda', a.id from antigas a where a.tenant_id = any(conectadas);
    elsif tg_op = 'INSERT' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select n.tenant_id, 'comanda', n.id from novas n where n.tenant_id = any(conectadas);
    else
      if not exists (select 1 from novas n where n.tenant_id = any(conectadas)) then
        return null;
      end if;
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select n.tenant_id, 'comanda', n.id
        from novas n
        join antigas a on a.id = n.id
       where n.tenant_id = any(conectadas)
         and (n.status, n.total, n.taxa_servico_pct, n.aberta_em, n.fechada_em, n.cancelada_em,
              n.unidade_id, n.mesa_id, n.idempotency_key, n.aberta_por_id)
             is distinct from
             (a.status, a.total, a.taxa_servico_pct, a.aberta_em, a.fechada_em, a.cancelada_em,
              a.unidade_id, a.mesa_id, a.idempotency_key, a.aberta_por_id);
    end if;
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- comanda_item: a comanda do item (os itens da venda — e do pedido ligado a ela). Uma linha por
-- comanda, não por item.
create or replace function integracao_mudou_comanda_item() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    -- Tabela de transição vazia (o UPDATE do INSERT … ON CONFLICT do push, a FK em cascata que
    -- não apagou nada): sai antes de qualquer consulta.
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas) then return null; end if;
    elsif not exists (select 1 from novas) then
      return null;
    end if;
    select array_agg(distinct t.tenant_id) into conectadas
      from integracao_token_loja t where t.revogado_em is null;
    if conectadas is null then
      return null;
    end if;
    if tg_op = 'DELETE' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select distinct a.tenant_id, 'comanda', a.comanda_id from antigas a where a.tenant_id = any(conectadas);
    elsif tg_op = 'INSERT' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select distinct n.tenant_id, 'comanda', n.comanda_id from novas n where n.tenant_id = any(conectadas);
    else
      if not exists (select 1 from novas n where n.tenant_id = any(conectadas)) then
        return null;
      end if;
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select distinct x.tenant_id, 'comanda', x.comanda_id
        from novas n
        join antigas a on a.id = n.id
        cross join lateral (values (n.tenant_id, n.comanda_id), (a.tenant_id, a.comanda_id)) as x(tenant_id, comanda_id)
       where n.tenant_id = any(conectadas)
         and (n.comanda_id, n.produto_id, n.descricao, n.quantidade, n.preco_unitario)
             is distinct from
             (a.comanda_id, a.produto_id, a.descricao, a.quantidade, a.preco_unitario);
    end if;
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- cliente: só a EXCLUSÃO (o "esquecer" da LGPD, ou a exclusão que sobe da loja pelo sync)
-- vira aviso de cliente anonimizado.
create or replace function integracao_mudou_cliente() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    if not exists (select 1 from antigas) then
      return null; -- exclusão que não apagou nada
    end if;
    select array_agg(distinct t.tenant_id) into conectadas
      from integracao_token_loja t where t.revogado_em is null;
    if conectadas is null then
      return null;
    end if;
    insert into integracao_mudanca (tenant_id, recurso, recurso_id)
    select a.tenant_id, 'cliente', a.id from antigas a where a.tenant_id = any(conectadas);
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_integracao_ins on pedido_externo;
drop trigger if exists trg_integracao_upd on pedido_externo;
drop trigger if exists trg_integracao_del on pedido_externo;
create trigger trg_integracao_ins after insert on pedido_externo
  referencing new table as novas for each statement execute function integracao_mudou_pedido();
create trigger trg_integracao_upd after update on pedido_externo
  referencing old table as antigas new table as novas for each statement execute function integracao_mudou_pedido();
create trigger trg_integracao_del after delete on pedido_externo
  referencing old table as antigas for each statement execute function integracao_mudou_pedido();

drop trigger if exists trg_integracao_ins on comanda;
drop trigger if exists trg_integracao_upd on comanda;
drop trigger if exists trg_integracao_del on comanda;
create trigger trg_integracao_ins after insert on comanda
  referencing new table as novas for each statement execute function integracao_mudou_comanda();
create trigger trg_integracao_upd after update on comanda
  referencing old table as antigas new table as novas for each statement execute function integracao_mudou_comanda();
create trigger trg_integracao_del after delete on comanda
  referencing old table as antigas for each statement execute function integracao_mudou_comanda();

drop trigger if exists trg_integracao_ins on comanda_item;
drop trigger if exists trg_integracao_upd on comanda_item;
drop trigger if exists trg_integracao_del on comanda_item;
create trigger trg_integracao_ins after insert on comanda_item
  referencing new table as novas for each statement execute function integracao_mudou_comanda_item();
create trigger trg_integracao_upd after update on comanda_item
  referencing old table as antigas new table as novas for each statement execute function integracao_mudou_comanda_item();
create trigger trg_integracao_del after delete on comanda_item
  referencing old table as antigas for each statement execute function integracao_mudou_comanda_item();

drop trigger if exists trg_integracao_del on cliente;
create trigger trg_integracao_del after delete on cliente
  referencing old table as antigas for each statement execute function integracao_mudou_cliente();

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`.
select 'tabela integracao_mudanca' as objeto,
       to_regclass(current_schema() || '.integracao_mudanca') is not null as ok
union all
select 'tabela integracao_versao',
       to_regclass(current_schema() || '.integracao_versao') is not null
union all
select 'tabela integracao_carga',
       to_regclass(current_schema() || '.integracao_carga') is not null
union all
select 'índices da integracao_versao (3)',
       (select count(*) from pg_indexes
         where schemaname = current_schema() and tablename = 'integracao_versao'
           and indexname in ('idx_integracao_versao_leitura', 'idx_integracao_versao_leitura_loja',
                             'idx_integracao_versao_pendente')) = 3
union all
select 'gatilhos em pedido_externo, comanda, comanda_item (3 cada) e cliente (1)',
       (select count(*) from pg_trigger g
          join pg_class c on c.oid = g.tgrelid
          join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = current_schema() and not g.tgisinternal
           and g.tgname in ('trg_integracao_ins', 'trg_integracao_upd', 'trg_integracao_del')
           and c.relname in ('pedido_externo', 'comanda', 'comanda_item', 'cliente')) = 10
union all
select 'RLS ligada nas 3 tabelas novas',
       (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = current_schema() and c.relrowsecurity
           and c.relname in ('integracao_mudanca', 'integracao_versao', 'integracao_carga')) = 3
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
