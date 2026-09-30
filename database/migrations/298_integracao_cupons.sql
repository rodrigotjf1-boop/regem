-- @cloud-only
-- 298_integracao_cupons.sql — CUPONS da API de integração (trilha C, C1c — PR3):
-- `GET /api/v1/integracao/cupons`, `GET /cupons/usos`, `POST /cupons` e `POST /cupons/{id}/desativar`.
--
-- O QUE ENTRA
--   1. Gatilhos POR COMANDO em `cupom` e `cupom_uso` que só ANOTAM na fila da mig 296
--      (`integracao_mudanca`), como os de venda: sem trava em linha compartilhada, só para empresa
--      CONECTADA (token ativo, mig 295); tabela de transição vazia, ou sem linha de empresa
--      conectada, sai logo no começo. A cascata `cupom → cupom_uso` dispara o gatilho do uso UMA vez
--      por exclusão (medido no PG 18.4 — ERR-129). O uso anota o USO e
--      o CUPOM dele (o cupom publica `usos`). O carimbador (job da nuvem) monta a foto, compara com a
--      última publicada e só sobe a versão se mudou; cupom ou uso APAGADO depois de publicado sai
--      como LÁPIDE (mesmo id, versão nova, `removido: true`) — excluir cupom é DELETE e cancelar o
--      pedido apaga o uso (achado A7): sem a lápide, o Liame nunca saberia.
--   2. `integracao_cupom`: a MARCA DE ORIGEM do cupom criado pela integração. O Liame só desativa o
--      cupom que ele criou (decisão do dono, 29/09/2026); o resto responde 404 (contrato de cupons
--      §3.4). Tabela à parte, sem coluna nova em `cupom`: `cupom` SINCRONIZA com a loja (desce, mig
--      272) — coluna nova ali exigiria migration no servidor da loja (`.zip`) e o `select` completo do
--      Drizzle quebraria onde ela ainda não existe (ERR-029).
--   3. `integracao_idempotencia`: `Idempotency-Key` das duas escritas (até 24 h). A chave é
--      reservada e a resposta gravada na MESMA transação da escrita.
--   4. `integracao_carga_cupom`: carga inicial dos cupons (todos) e dos usos (91 dias) por empresa —
--      separada da carga das vendas (mig 296), para a empresa já carregada antes desta migration
--      ganhar a carga dos cupons sem repetir a das vendas.
--   5. A fila e as versões passam a aceitar 'cupom' e 'cupom_uso' (os `check` da 296).
--
-- ⚠️ NUNCA PODE FALHAR: uma exceção no gatilho derrubaria o pedido do cardápio (o uso do cupom) ou
--    o push da loja. O corpo roda num bloco com `exception when others` (vira AVISO no log do
--    Postgres; a reconciliação diária cobre o que escapar) e com `lock_timeout` curto.
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. As tabelas novas não existem lá e não
--    entram no sincronismo (nem nas listas do sync-daemon); os gatilhos só existem aqui e disparam
--    também quando o push da loja aplica a linha (o apagar do uso que vem pelo `sync_exclusao`).
--    O cupom criado pela API é um cupom como outro qualquer: DESCE para a loja pelo sync de sempre.
-- ⚠️ DEPENDE da 295 e da 296. Aplicar na NUVEM ANTES do merge, fora do pico: criar gatilho pede uma
--    trava rápida em `cupom`/`cupom_uso`, e trocar os `check` pede uma trava rápida na fila
--    (`integracao_mudanca`) — por isso vêm por ÚLTIMO, logo antes do commit. O `lock_timeout` faz a
--    migration desistir (sem mudar nada) em vez de segurar os pedidos.
-- Idempotente (if not exists / create or replace / drop … if exists).
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_versao') is null
     or to_regclass(current_schema() || '.integracao_mudanca') is null then
    raise exception 'A 298 depende da 295 e da 296 (tokens, fila e versões da integração): aplique-as antes.';
  end if;
  if to_regclass(current_schema() || '.cupom') is null or to_regclass(current_schema() || '.cupom_uso') is null then
    raise exception 'A 298 precisa das tabelas cupom e cupom_uso (migs 044 e 076).';
  end if;
end $$;

-- ── Marca de origem: cupom criado pela integração ────────────────────────────────────────
-- Sem chave estrangeira de propósito: `cupom` é tabela quente que sincroniza; a FK poria uma ação
-- em cascata nela. Marca de cupom já apagado não atrapalha (o desativar procura o cupom primeiro).
create table if not exists integracao_cupom (
  cupom_id   uuid primary key,
  tenant_id  uuid not null,
  unidade_id uuid not null,                          -- loja do token que criou
  cliente    text not null,                          -- 'liame'
  token_id   uuid not null,                          -- token que criou (o token pode ser trocado; a marca fica)
  chave      text,                                   -- Idempotency-Key da criação (rastreio)
  criado_em  timestamptz not null default now()
);

-- ── Idempotência das escritas (até 24 h) ─────────────────────────────────────────────────
-- A chave é da LOJA e do cliente de integração, não do token: o token novo da mesma loja (troca de
-- escopos) repetindo a mesma chave recebe a mesma resposta.
create table if not exists integracao_idempotencia (
  tenant_id   uuid not null,
  unidade_id  uuid not null,
  cliente     text not null,
  chave       text not null,
  token_id    uuid not null,                         -- quem usou a chave primeiro
  rota        text not null,                         -- 'POST /cupons' | 'POST /cupons/{id}/desativar'
  hash_corpo  text not null,                         -- sha256 de método + caminho + corpo canônico
  status_http integer,                               -- gravado na mesma transação da escrita
  resposta    jsonb,
  criado_em   timestamptz not null default now(),
  primary key (tenant_id, unidade_id, cliente, chave),
  constraint ck_integracao_idempotencia_chave check (char_length(chave) between 1 and 255)
);
create index if not exists idx_integracao_idempotencia_criado on integracao_idempotencia (criado_em);

-- ── Carga inicial dos cupons, por empresa ────────────────────────────────────────────────
create table if not exists integracao_carga_cupom (
  tenant_id uuid primary key,
  feita_em  timestamptz not null
);

-- Fora do alcance da API REST anônima (o app usa um papel que atravessa a RLS — a conferência diz).
alter table integracao_cupom enable row level security;
alter table integracao_idempotencia enable row level security;
alter table integracao_carga_cupom enable row level security;

-- ── Gatilhos (por comando, com tabela de transição) ──────────────────────────────────────
-- cupom: o próprio cupom. Update só conta se mudou coluna que a API devolve (o carimbo
-- `updated_at` sozinho, como no "recriar" da tela com os mesmos valores, não gera versão).
create or replace function integracao_mudou_cupom() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    -- Tabela de transição vazia (o UPDATE do INSERT … ON CONFLICT sem linha, a exclusão que não
    -- apagou nada): sai antes de qualquer consulta.
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
    -- Nenhuma linha de empresa conectada no comando: uma passada pela transição e sai.
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas a where a.tenant_id = any(conectadas)) then return null; end if;
    elsif not exists (select 1 from novas n where n.tenant_id = any(conectadas)) then
      return null;
    end if;
    if tg_op = 'DELETE' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select a.tenant_id, 'cupom', a.id from antigas a where a.tenant_id = any(conectadas);
    elsif tg_op = 'INSERT' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select n.tenant_id, 'cupom', n.id from novas n where n.tenant_id = any(conectadas);
    else
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select n.tenant_id, 'cupom', n.id
        from novas n
        join antigas a on a.id = n.id
       where n.tenant_id = any(conectadas)
         and (n.codigo, n.nome, n.tipo, n.valor, n.teto_desconto, n.minimo, n.ativo, n.validade, n.valido_de,
              n.max_usos, n.somente_novos, n.max_por_cliente, n.min_dias_sem_compra, n.unidade_id)
             is distinct from
             (a.codigo, a.nome, a.tipo, a.valor, a.teto_desconto, a.minimo, a.ativo, a.validade, a.valido_de,
              a.max_usos, a.somente_novos, a.max_por_cliente, a.min_dias_sem_compra, a.unidade_id);
    end if;
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- cupom_uso: o uso e o CUPOM dele (a contagem `usos` muda). Uma linha por cupom, não por uso.
create or replace function integracao_mudou_cupom_uso() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
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
    -- Nenhuma linha de empresa conectada no comando: uma passada pela transição e sai.
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas a where a.tenant_id = any(conectadas)) then return null; end if;
    elsif not exists (select 1 from novas n where n.tenant_id = any(conectadas)) then
      return null;
    end if;
    if tg_op = 'DELETE' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select a.tenant_id, 'cupom_uso'::text, a.id from antigas a where a.tenant_id = any(conectadas)
      union all
      select x.tenant_id, 'cupom'::text, x.cupom_id
        from (select distinct a.tenant_id, a.cupom_id from antigas a where a.tenant_id = any(conectadas)) x;
    elsif tg_op = 'INSERT' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select n.tenant_id, 'cupom_uso'::text, n.id from novas n where n.tenant_id = any(conectadas)
      union all
      select x.tenant_id, 'cupom'::text, x.cupom_id
        from (select distinct n.tenant_id, n.cupom_id from novas n where n.tenant_id = any(conectadas)) x;
    else
      with mudou as materialized (
        select n.tenant_id, n.id, n.cupom_id as novo, a.cupom_id as antigo
          from novas n
          join antigas a on a.id = n.id
         where n.tenant_id = any(conectadas)
           and (n.cupom_id, n.pedido_id, n.usado_em) is distinct from (a.cupom_id, a.pedido_id, a.usado_em)
      )
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select m.tenant_id, 'cupom_uso'::text, m.id from mudou m
      union all
      select x.tenant_id, 'cupom'::text, x.cupom_id
        from (select m.tenant_id, m.novo as cupom_id from mudou m
              union
              select m.tenant_id, m.antigo from mudou m where m.antigo is distinct from m.novo) x;
    end if;
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_integracao_ins on cupom;
drop trigger if exists trg_integracao_upd on cupom;
drop trigger if exists trg_integracao_del on cupom;
create trigger trg_integracao_ins after insert on cupom
  referencing new table as novas for each statement execute function integracao_mudou_cupom();
create trigger trg_integracao_upd after update on cupom
  referencing old table as antigas new table as novas for each statement execute function integracao_mudou_cupom();
create trigger trg_integracao_del after delete on cupom
  referencing old table as antigas for each statement execute function integracao_mudou_cupom();

drop trigger if exists trg_integracao_ins on cupom_uso;
drop trigger if exists trg_integracao_upd on cupom_uso;
drop trigger if exists trg_integracao_del on cupom_uso;
create trigger trg_integracao_ins after insert on cupom_uso
  referencing new table as novas for each statement execute function integracao_mudou_cupom_uso();
create trigger trg_integracao_upd after update on cupom_uso
  referencing old table as antigas new table as novas for each statement execute function integracao_mudou_cupom_uso();
create trigger trg_integracao_del after delete on cupom_uso
  referencing old table as antigas for each statement execute function integracao_mudou_cupom_uso();

-- ── A fila e as versões aceitam 'cupom' e 'cupom_uso' (por ÚLTIMO: trava curta na fila) ───
-- Os `check` novos contêm os antigos: toda linha que já existe continua valendo.
alter table integracao_mudanca drop constraint if exists ck_integracao_mudanca_recurso;
alter table integracao_mudanca add constraint ck_integracao_mudanca_recurso
  check (recurso in ('pedido', 'comanda', 'cliente', 'cupom', 'cupom_uso'));
alter table integracao_versao drop constraint if exists ck_integracao_versao_fonte;
alter table integracao_versao add constraint ck_integracao_versao_fonte check (
  (recurso = 'venda' and fonte in ('pedido_externo', 'comanda'))
  or (recurso = 'cliente' and fonte = 'cliente')
  or (recurso = 'cupom' and fonte = 'cupom')
  or (recurso = 'cupom_uso' and fonte = 'cupom_uso')
);

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`.
select 'tabela integracao_cupom (marca de origem)' as objeto,
       to_regclass(current_schema() || '.integracao_cupom') is not null as ok
union all
select 'tabela integracao_idempotencia',
       to_regclass(current_schema() || '.integracao_idempotencia') is not null
union all
select 'tabela integracao_carga_cupom',
       to_regclass(current_schema() || '.integracao_carga_cupom') is not null
union all
select 'RLS ligada nas 3 tabelas novas',
       (select count(*) from pg_class c join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = current_schema() and c.relrowsecurity
           and c.relname in ('integracao_cupom', 'integracao_idempotencia', 'integracao_carga_cupom')) = 3
union all
select 'gatilhos em cupom e cupom_uso (3 cada)',
       (select count(*) from pg_trigger g
          join pg_class c on c.oid = g.tgrelid
          join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = current_schema() and not g.tgisinternal
           and g.tgname in ('trg_integracao_ins', 'trg_integracao_upd', 'trg_integracao_del')
           and c.relname in ('cupom', 'cupom_uso')) = 6
union all
select 'a fila e as versões aceitam cupom e cupom_uso',
       (select count(*) from pg_constraint k
         where k.conrelid in (to_regclass(current_schema() || '.integracao_mudanca'),
                              to_regclass(current_schema() || '.integracao_versao'))
           and k.conname in ('ck_integracao_mudanca_recurso', 'ck_integracao_versao_fonte')
           and position('cupom_uso' in pg_get_constraintdef(k.oid)) > 0) = 2
union all
select 'índice único do código do cupom (o 409 depende dele)',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'cupom' and indexname = 'uq_cupom_tenant_codigo')
union all
select 'colunas do cupom que a API lê e grava (17)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'cupom'
           and column_name in ('id', 'tenant_id', 'unidade_id', 'codigo', 'nome', 'tipo', 'valor', 'teto_desconto',
                               'minimo', 'ativo', 'validade', 'valido_de', 'max_usos', 'somente_novos',
                               'max_por_cliente', 'min_dias_sem_compra', 'updated_at')) = 17
union all
select 'colunas do cupom_uso que a API lê (6)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'cupom_uso'
           and column_name in ('id', 'tenant_id', 'cupom_id', 'pedido_id', 'usado_em', 'created_at')) = 6
union all
select 'o carimbo do cupom (trg_bump_updated_at, mig 272): a desativação desce para a loja',
       exists (select 1 from pg_trigger g
                 join pg_class c on c.oid = g.tgrelid
                 join pg_namespace s on s.oid = c.relnamespace
                where s.nspname = current_schema() and c.relname = 'cupom' and g.tgname = 'trg_bump_updated_at')
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
