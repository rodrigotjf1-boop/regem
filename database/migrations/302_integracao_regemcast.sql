-- @cloud-only
-- 302_integracao_regemcast.sql — API de integração para o REGEMCAST (campanhas de WhatsApp da
-- DMS): clientes e vendas da EMPRESA inteira (decisões do dono, 30/09/2026 — ver
-- docs/integracao-regemcast.md). O RegemCast só LÊ.
--
-- O QUE ENTRA
--   1. Token de EMPRESA: `integracao_token_loja.unidade_id` passa a aceitar nulo = a empresa
--      inteira — SÓ para o cliente `regemcast` (trava no banco; o do Liame continua por loja).
--   2. Escopos novos no `check`: `clientes.ler` (a lista de clientes) e `vendas.99food.ler`
--      (vendas e clientes da 99, com a autorização do dono registrada no RegemCast).
--   3. A fila e as versões aceitam o recurso `contato` (a ficha do cliente para `GET /clientes`).
--      Os `check` novos contêm os antigos: toda linha que já existe continua valendo.
--   4. Gatilhos NOVOS e SEPARADOS (os da 296/298/299 não mudam) que anotam "a ficha do cliente
--      mudou" — só para empresa com token ativo que tem `clientes.ler`:
--        • `cliente`: inclusão, exclusão e mudança de nome, telefone ou opt-out;
--        • `cliente_endereco`: qualquer mudança (bairro e cidade saem do endereço);
--        • `marketing_consentimento` (mig 300): cada evento de aceite/recusa/saída/volta.
--      A venda que muda os canais do cliente é anotada pelo carimbador (a fila de `pedido`).
--   5. `integracao_carga_janela`: a carga inicial do RegemCast (3 anos de vendas + a base de
--      clientes), em FATIAS e só quando a fila está quase vazia — a mudança do dia a dia (a do
--      Liame também) nunca espera atrás dela.
--
-- ⚠️ NUNCA PODE FALHAR: o corpo dos gatilhos roda num bloco com `exception when others` (vira
--    AVISO no log; a reconciliação diária cobre o que escapar) e com `lock_timeout` curto.
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro.
-- ⚠️ DEPENDE da 295, 296, 298 e 300. Aplicar na NUVEM ANTES do merge. Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_mudanca') is null
     or to_regclass(current_schema() || '.marketing_consentimento') is null then
    raise exception 'A 302 depende da 295, 296, 298 e 300 (tokens, fila e consentimento): aplique-as antes.';
  end if;
end $$;

-- ── 1 e 2. Token de empresa (só RegemCast) e escopos novos ───────────────────────────────
alter table integracao_token_loja alter column unidade_id drop not null;
alter table integracao_token_loja drop constraint if exists ck_integracao_token_loja_abrangencia;
alter table integracao_token_loja add constraint ck_integracao_token_loja_abrangencia
  check (unidade_id is not null or cliente = 'regemcast');
alter table integracao_token_loja drop constraint if exists ck_integracao_token_loja_escopos;
alter table integracao_token_loja add constraint ck_integracao_token_loja_escopos check (
  cardinality(escopos) > 0
  and escopos <@ array['pedidos.ler', 'clientes.telefone.ler', 'custos.ler',
                       'clientes.anonimizacao.ler', 'cupons.ler', 'cupons.uso.ler',
                       'cupons.criar', 'clientes.ler', 'vendas.99food.ler']::text[]
);

-- ── 5. Carga inicial do RegemCast, em fatias (uma linha por empresa e cliente) ───────────
create table if not exists integracao_carga_janela (
  tenant_id      uuid not null,
  cliente        text not null,                 -- 'regemcast'
  desde          timestamptz not null,          -- início da janela (3 anos atrás)
  vendas_ate     timestamptz,                   -- vendas: a próxima fatia termina aqui (anda para trás)
  clientes_apos  uuid,                          -- clientes: o último id enfileirado (anda para frente)
  clientes_ok    boolean not null default false,
  iniciada_em    timestamptz not null default now(),
  feita_em       timestamptz,                   -- nulo = em andamento
  primary key (tenant_id, cliente)
);
alter table integracao_carga_janela enable row level security;

-- ── 4. Gatilhos: a ficha do cliente mudou (só empresa com token `clientes.ler`) ─────────
create or replace function integracao_contato_conectadas() returns uuid[]
language sql stable as $$
  select array_agg(distinct t.tenant_id)
    from integracao_token_loja t
   where t.revogado_em is null and 'clientes.ler' = any(t.escopos)
$$;

-- cliente: inclusão/exclusão sempre; alteração só quando muda o que a ficha mostra.
create or replace function integracao_contato_cliente() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    -- Tabela de transição vazia (a FK em cascata da empresa que não apagou nada, o UPDATE do
    -- INSERT … ON CONFLICT do push): sai antes de qualquer consulta (ERR-125).
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas) then return null; end if;
    elsif not exists (select 1 from novas) then
      return null;
    end if;
    conectadas := integracao_contato_conectadas();
    if conectadas is null then
      return null;
    end if;
    if tg_op = 'INSERT' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select n.tenant_id, 'contato', n.id from novas n where n.tenant_id = any(conectadas);
    elsif tg_op = 'DELETE' then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select a.tenant_id, 'contato', a.id from antigas a where a.tenant_id = any(conectadas);
    else
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select n.tenant_id, 'contato', n.id
        from novas n join antigas a on a.id = n.id
       where n.tenant_id = any(conectadas)
         and (n.nome, n.telefone, n.opt_out_marketing, n.tenant_id)
             is distinct from (a.nome, a.telefone, a.opt_out_marketing, a.tenant_id);
    end if;
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists trg_integracao_contato_ins on cliente;
create trigger trg_integracao_contato_ins after insert on cliente
  referencing new table as novas for each statement execute function integracao_contato_cliente();
drop trigger if exists trg_integracao_contato_upd on cliente;
create trigger trg_integracao_contato_upd after update on cliente
  referencing old table as antigas new table as novas for each statement execute function integracao_contato_cliente();
drop trigger if exists trg_integracao_contato_del on cliente;
create trigger trg_integracao_contato_del after delete on cliente
  referencing old table as antigas for each statement execute function integracao_contato_cliente();

-- cliente_endereco: bairro e cidade da ficha saem do endereço do cliente.
create or replace function integracao_contato_endereco() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    -- Filha de `cliente` com FK em cascata: apagar N clientes dispara este gatilho N vezes, quase
    -- sempre com a tabela de transição vazia — sai antes de qualquer consulta (ERR-125).
    if tg_op = 'DELETE' then
      if not exists (select 1 from antigas) then return null; end if;
    elsif not exists (select 1 from novas) then
      return null;
    end if;
    conectadas := integracao_contato_conectadas();
    if conectadas is null then
      return null;
    end if;
    if tg_op in ('INSERT', 'UPDATE') then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select distinct n.tenant_id, 'contato', n.cliente_id from novas n
       where n.tenant_id = any(conectadas) and n.cliente_id is not null;
    end if;
    if tg_op in ('DELETE', 'UPDATE') then
      insert into integracao_mudanca (tenant_id, recurso, recurso_id)
      select distinct a.tenant_id, 'contato', a.cliente_id from antigas a
       where a.tenant_id = any(conectadas) and a.cliente_id is not null;
    end if;
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists trg_integracao_contato_ins on cliente_endereco;
create trigger trg_integracao_contato_ins after insert on cliente_endereco
  referencing new table as novas for each statement execute function integracao_contato_endereco();
drop trigger if exists trg_integracao_contato_upd on cliente_endereco;
create trigger trg_integracao_contato_upd after update on cliente_endereco
  referencing old table as antigas new table as novas for each statement execute function integracao_contato_endereco();
drop trigger if exists trg_integracao_contato_del on cliente_endereco;
create trigger trg_integracao_contato_del after delete on cliente_endereco
  referencing old table as antigas for each statement execute function integracao_contato_endereco();

-- marketing_consentimento (mig 300): o evento vale para o cadastro dele e para todo cliente da
-- empresa com o MESMO número (chave do telefone: com/sem 55, com/sem o nono dígito).
create or replace function integracao_contato_consentimento() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    if not exists (select 1 from novas) then
      return null;
    end if;
    conectadas := integracao_contato_conectadas();
    if conectadas is null then
      return null;
    end if;
    insert into integracao_mudanca (tenant_id, recurso, recurso_id)
    select distinct c.tenant_id, 'contato', c.id
      from novas n
      join cliente c on c.tenant_id = n.tenant_id
                    and (c.id = n.cliente_id or regem_telefone_chave(c.telefone) = n.telefone_chave)
     where n.tenant_id = any(conectadas);
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
drop trigger if exists trg_integracao_contato_ins on marketing_consentimento;
create trigger trg_integracao_contato_ins after insert on marketing_consentimento
  referencing new table as novas for each statement execute function integracao_contato_consentimento();

-- ── 3. A fila e as versões aceitam 'contato' (por ÚLTIMO: trava curta na fila) ───────────
alter table integracao_mudanca drop constraint if exists ck_integracao_mudanca_recurso;
alter table integracao_mudanca add constraint ck_integracao_mudanca_recurso
  check (recurso in ('pedido', 'comanda', 'cliente', 'cupom', 'cupom_uso', 'contato'));
alter table integracao_versao drop constraint if exists ck_integracao_versao_fonte;
alter table integracao_versao add constraint ck_integracao_versao_fonte check (
  (recurso = 'venda' and fonte in ('pedido_externo', 'comanda'))
  or (recurso = 'cliente' and fonte = 'cliente')
  or (recurso = 'cupom' and fonte = 'cupom')
  or (recurso = 'cupom_uso' and fonte = 'cupom_uso')
  or (recurso = 'contato' and fonte = 'cliente')
);

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`. (Restrições procuradas só neste
-- schema: o banco de teste tem outros schemas com os mesmos nomes.)
with ns as (select oid from pg_namespace where nspname = current_schema())
select 'token de empresa só para o regemcast' as objeto,
       exists (select 1 from pg_constraint where conname = 'ck_integracao_token_loja_abrangencia'
                                            and connamespace = (select oid from ns)) as ok
union all
select 'unidade_id do token aceita nulo',
       (select is_nullable from information_schema.columns
         where table_schema = current_schema() and table_name = 'integracao_token_loja'
           and column_name = 'unidade_id') = 'YES'
union all
select 'escopos novos no check (clientes.ler e vendas.99food.ler)',
       pg_get_constraintdef((select oid from pg_constraint where conname = 'ck_integracao_token_loja_escopos' and connamespace = (select oid from ns)))
         like '%vendas.99food.ler%'
union all
select 'fila aceita contato',
       pg_get_constraintdef((select oid from pg_constraint where conname = 'ck_integracao_mudanca_recurso' and connamespace = (select oid from ns))) like '%contato%'
union all
select 'versões aceitam contato',
       pg_get_constraintdef((select oid from pg_constraint where conname = 'ck_integracao_versao_fonte' and connamespace = (select oid from ns))) like '%contato%'
union all
select 'tabela integracao_carga_janela',
       to_regclass(current_schema() || '.integracao_carga_janela') is not null
union all
select 'gatilhos da ficha do cliente (7)',
       (select count(*) from pg_trigger g
          join pg_class c on c.oid = g.tgrelid
          join pg_namespace s on s.oid = c.relnamespace
         where s.nspname = current_schema() and not g.tgisinternal
           and g.tgname like 'trg_integracao_contato_%'
           and c.relname in ('cliente', 'cliente_endereco', 'marketing_consentimento')) = 7
union all
select 'RLS ligada na carga da janela',
       exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                where s.nspname = current_schema() and c.relname = 'integracao_carga_janela' and c.relrowsecurity)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
