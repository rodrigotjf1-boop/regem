-- 274_paridade_cashback_fidelidade.sql — o dinheiro do cliente passa a existir dos dois lados.
--
-- ⚠️ NÃO é @cloud-only: nuvem e servidor local gravam cashback e fidelidade.
-- ⚠️ Aplicar ANTES do merge. Idempotente. Depende da 259, 262 e 264 (marca de sessão,
--    funções de carimbo/exclusão e marcador de mudança).
--
-- POR QUÊ — o problema é de dinheiro, não de sincronismo
-- O crédito de cashback acontece NOS DOIS LADOS (o painel de delivery roda no servidor
-- local), mas o gasto só existe na nuvem (cardápio online). Como nenhuma das nove tabelas
-- sincronizava:
--   • cashback creditado num pedido atendido pela loja NÃO EXISTE para o cliente — ele
--     nunca consegue gastar, e os relatórios da loja e da nuvem divergem;
--   • o ESTORNO de um pedido cancelado na loja não chega à nuvem: o cliente fica com o
--     cashback de um pedido cancelado e pode gastá-lo;
--   • prêmio marcado como usado de um lado continua disponível do outro (uso duplo);
--   • plano criado na loja nunca aparece para o cliente, sem erro nenhum.
--
-- DESENHO — saldo é CACHE, o extrato é a verdade
-- `cashback_saldo` e `fidelidade_cliente` guardam um NÚMERO. Sincronizar número por
-- "última escrita vence" faz um crédito apagar o outro: dois lados creditam R$ 5 e R$ 8 e
-- o saldo final vira 8 em vez de 13. Por isso eles NÃO sincronizam — passam a ser
-- RECALCULADOS a partir do extrato (que sincroniza e é só-anexar, sem conflito possível):
--   • cashback: saldo = soma dos deltas do extrato (a expiração já é lançada como delta
--     negativo pelo próprio serviço, então a conta fecha);
--   • fidelidade: pontos = pontos válidos do plano − (meta × prêmios já gerados).
-- O recálculo é feito por GATILHO, então vale tanto para a operação normal quanto para a
-- linha que chega pelo sync — sem mudar uma linha do serviço.
--
-- ⚠️ ANTES DE APLICAR, meça a divergência de hoje (consulta só de leitura):
--   select s.tenant_id, s.telefone, s.tipo, s.saldo as saldo_hoje,
--          greatest(0, coalesce(sum(m.delta), 0)) as saldo_pelo_extrato
--     from cashback_saldo s
--     left join cashback_movimento m
--       on m.tenant_id = s.tenant_id and m.telefone = s.telefone and m.tipo = s.tipo
--    group by s.tenant_id, s.telefone, s.tipo, s.saldo
--   having s.saldo <> greatest(0, coalesce(sum(m.delta), 0));
-- Linha nenhuma = o recálculo não muda saldo de ninguém.

-- ── 1) Colunas de data que faltavam ───────────────────────────────────────────────────
alter table cashback_plano          add column if not exists atualizado_em timestamptz not null default now();
alter table cashback_vale           add column if not exists atualizado_em timestamptz not null default now();
alter table fidelidade_plano        add column if not exists atualizado_em timestamptz not null default now();
alter table fidelidade_ponto        add column if not exists atualizado_em timestamptz not null default now();
alter table fidelidade_resgate      add column if not exists atualizado_em timestamptz not null default now();
alter table cashback_produto_valor  add column if not exists criado_em     timestamptz not null default now();

-- Alinha com a data real da linha (senão o primeiro ciclo sobe o histórico inteiro como
-- se tudo tivesse mudado agora).
update cashback_plano     set atualizado_em = criado_em where atualizado_em > criado_em;
update cashback_vale      set atualizado_em = criado_em where atualizado_em > criado_em;
update fidelidade_plano   set atualizado_em = criado_em where atualizado_em > criado_em;
update fidelidade_ponto   set atualizado_em = criado_em where atualizado_em > criado_em;
update fidelidade_resgate set atualizado_em = ganho_em  where ganho_em is not null and atualizado_em > ganho_em;

-- ── 2) Carimbo automático ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'cashback_plano','cashback_vale','fidelidade_plano','fidelidade_ponto','fidelidade_resgate'
  ] loop
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = t and column_name = 'atualizado_em') then
      execute format('drop trigger if exists trg_bump_atualizado_em on %I', t);
      execute format('create trigger trg_bump_atualizado_em before update on %I '
                     || 'for each row execute function bump_atualizado_em()', t);
    end if;
  end loop;
end $$;

-- ── 3) Saldo de cashback recalculado do extrato ───────────────────────────────────────
-- Roda depois de QUALQUER movimento (inclusive o que chega pelo sync) e reescreve o cache.
-- Não depende de quem inseriu nem da ordem de chegada: soma tudo de novo.
create or replace function cashback_saldo_do_extrato() returns trigger as $$
declare
  v_saldo numeric;
begin
  -- Mesma guarda do lado da fidelidade: numa exclusao em cascata o pai ja sumiu.
  if not exists (select 1 from empresa where id = new.tenant_id) then return new; end if;
  select greatest(0, coalesce(sum(delta), 0)) into v_saldo
    from cashback_movimento
   where tenant_id = new.tenant_id and telefone = new.telefone and tipo = new.tipo;

  insert into cashback_saldo (tenant_id, telefone, cliente_id, tipo, saldo)
  values (new.tenant_id, new.telefone, new.cliente_id, new.tipo, v_saldo)
  on conflict (tenant_id, telefone, tipo) do update
    set saldo = excluded.saldo,
        -- não perde a ligação com o cadastro nem o prazo já gravado
        cliente_id = coalesce(cashback_saldo.cliente_id, excluded.cliente_id),
        atualizado_em = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_cashback_saldo on cashback_movimento;
create trigger trg_cashback_saldo after insert on cashback_movimento
  for each row execute function cashback_saldo_do_extrato();

-- ── 3b) Ajuste manual de pontos vira LANÇAMENTO ───────────────────────────────────────
-- O gerente pode somar ou tirar pontos na mão ("cliente reclamou", "erro de digitação").
-- Isso não nasce de pedido nenhum, então não aparecia em lugar nenhum: era escrito direto
-- no número. Com o saldo passando a ser recalculado, um ajuste desses sumiria no próximo
-- ponto. Agora ele é um lançamento — entra na conta, sincroniza e fica como histórico de
-- quem mexeu no saldo do cliente.
create table if not exists fidelidade_ajuste (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  plano_id uuid not null references fidelidade_plano(id) on delete cascade,
  telefone text not null,
  cliente_id uuid,
  delta integer not null,            -- + adiciona | − retira
  motivo text,
  criado_por_id uuid,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_fidelidade_ajuste_sync on fidelidade_ajuste (tenant_id, criado_em, id);
create index if not exists idx_fidelidade_ajuste_saldo on fidelidade_ajuste (tenant_id, plano_id, telefone);

-- ── 4) Pontos de fidelidade recalculados ──────────────────────────────────────────────
-- pontos válidos + ajustes manuais − (meta × prêmios já gerados). O extrato manda.
create or replace function fidelidade_pontos_do_extrato() returns trigger as $$
declare
  v_tenant uuid; v_plano uuid; v_tel text; v_cliente uuid;
  v_ganhos int; v_premios int; v_meta int; v_pontos int; v_ajustes int;
begin
  -- Em DELETE não existe `new` (ler new.* ali é erro em tempo de execução), então a
  -- origem dos dados depende da operação.
  if tg_op = 'DELETE' then
    v_tenant := old.tenant_id; v_plano := old.plano_id; v_tel := old.telefone; v_cliente := old.cliente_id;
  else
    v_tenant := new.tenant_id; v_plano := new.plano_id; v_tel := new.telefone; v_cliente := new.cliente_id;
  end if;
  if v_plano is null or v_tel is null then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;
  -- EXCLUSÃO EM CASCATA: apagar a empresa (ou o plano) remove as linhas filhas, e cada
  -- remoção chamaria este recálculo, que tentaria RECRIAR a linha do cliente apontando
  -- para uma empresa que está sumindo — erro de chave estrangeira no meio do delete.
  -- Se o pai já não existe, não há saldo para recalcular.
  if not exists (select 1 from fidelidade_plano where id = v_plano)
     or not exists (select 1 from empresa where id = v_tenant) then
    if tg_op = 'DELETE' then return old; else return new; end if;
  end if;

  select coalesce(pontos_meta, 0) into v_meta from fidelidade_plano where id = v_plano;
  select count(*) into v_ganhos from fidelidade_ponto
   where tenant_id = v_tenant and plano_id = v_plano and telefone = v_tel and estornado = false;
  select count(*) into v_premios from fidelidade_resgate
   where tenant_id = v_tenant and plano_id = v_plano and telefone = v_tel;
  select coalesce(sum(delta), 0) into v_ajustes from fidelidade_ajuste
   where tenant_id = v_tenant and plano_id = v_plano and telefone = v_tel;

  v_pontos := greatest(0, v_ganhos + v_ajustes - (coalesce(v_meta, 0) * v_premios));

  insert into fidelidade_cliente (tenant_id, plano_id, telefone, cliente_id, pontos)
  values (v_tenant, v_plano, v_tel, v_cliente, v_pontos)
  on conflict (plano_id, telefone) do update
    set pontos = excluded.pontos,
        cliente_id = coalesce(fidelidade_cliente.cliente_id, excluded.cliente_id),
        atualizado_em = now();
  if tg_op = 'DELETE' then return old; else return new; end if;
end;
$$ language plpgsql;

drop trigger if exists trg_fidelidade_pontos_ponto on fidelidade_ponto;
create trigger trg_fidelidade_pontos_ponto after insert or update on fidelidade_ponto
  for each row execute function fidelidade_pontos_do_extrato();

drop trigger if exists trg_fidelidade_pontos_ajuste on fidelidade_ajuste;
create trigger trg_fidelidade_pontos_ajuste after insert or update or delete on fidelidade_ajuste
  for each row execute function fidelidade_pontos_do_extrato();

drop trigger if exists trg_fidelidade_pontos_resgate on fidelidade_resgate;
create trigger trg_fidelidade_pontos_resgate after insert on fidelidade_resgate
  for each row execute function fidelidade_pontos_do_extrato();

-- ── 4b) Correção de uma vez do que já está gravado ────────────────────────────────────
-- MEDIDO na base de produção em 20/09/2026, antes de aplicar: 2.428 saldos de cashback,
-- 1 com divergência real (R$ 3,06) e o resto com poeira de ponto flutuante (o saldo era
-- somado em JavaScript: 14,15 + 0,05 virava 14,199999999999999 e ia gravado assim).
--
-- O caso real prova o defeito: o cliente resgatou R$ 3,40 num pedido e, 4 ms depois,
-- ganhou R$ 3,06 de cashback pelo MESMO pedido. As duas operações leram o saldo e
-- gravaram uma por cima da outra — a do resgate chegou por último e apagou o crédito.
-- O extrato tem as três linhas certas; só o número guardado ficou errado.
--
-- Cashback: o extrato manda, então o saldo é reescrito com a soma.
update cashback_saldo s
   set saldo = x.total, atualizado_em = now()
  from (
    select s2.id, greatest(0, coalesce(sum(m.delta), 0)) as total
      from cashback_saldo s2
      left join cashback_movimento m
        on m.tenant_id = s2.tenant_id and m.telefone = s2.telefone and m.tipo = s2.tipo
     group by s2.id
  ) x
 where x.id = s.id and s.saldo is distinct from x.total;

-- Fidelidade: aqui NÃO dá para simplesmente recalcular. O ajuste manual de pontos era
-- escrito direto no número e não deixava rastro nenhum — recalcular apagaria o que o
-- gerente deu ou tirou na mão. Então a diferença de hoje vira um LANÇAMENTO de abertura,
-- e o número atual fica preservado. Daqui em diante tudo tem extrato.
insert into fidelidade_ajuste (tenant_id, plano_id, telefone, cliente_id, delta, motivo)
select c.tenant_id, c.plano_id, c.telefone, c.cliente_id,
       c.pontos - (
         coalesce((select count(*) from fidelidade_ponto p
                    where p.tenant_id = c.tenant_id and p.plano_id = c.plano_id
                      and p.telefone = c.telefone and p.estornado = false), 0)
         - coalesce((select count(*) from fidelidade_resgate r
                      where r.tenant_id = c.tenant_id and r.plano_id = c.plano_id
                        and r.telefone = c.telefone), 0)
           * coalesce((select pontos_meta from fidelidade_plano where id = c.plano_id), 0)
       ) as diferenca,
       'saldo anterior a mig 274 (ajustes manuais nao tinham registro)'
  from fidelidade_cliente c
 where c.plano_id is not null
   and c.pontos <> (
         coalesce((select count(*) from fidelidade_ponto p
                    where p.tenant_id = c.tenant_id and p.plano_id = c.plano_id
                      and p.telefone = c.telefone and p.estornado = false), 0)
         - coalesce((select count(*) from fidelidade_resgate r
                      where r.tenant_id = c.tenant_id and r.plano_id = c.plano_id
                        and r.telefone = c.telefone), 0)
           * coalesce((select pontos_meta from fidelidade_plano where id = c.plano_id), 0)
       )
   -- Idempotente: se já existe o lançamento de abertura deste cliente, não cria outro.
   and not exists (
     select 1 from fidelidade_ajuste a
      where a.tenant_id = c.tenant_id and a.plano_id = c.plano_id and a.telefone = c.telefone
        and a.motivo like 'saldo anterior a mig 274%'
   );

-- ── 5) Marcador de mudança e exclusão ─────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'cashback_plano','cashback_produto_valor','cashback_movimento','cashback_vale',
    'fidelidade_plano','fidelidade_ponto','fidelidade_resgate','fidelidade_ajuste'
  ] loop
    if exists (select 1 from information_schema.tables
                where table_schema = current_schema() and table_name = t) then
      execute format('drop trigger if exists trg_sync_marcador_ins on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_upd on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_del on %I', t);
      execute format('create trigger trg_sync_marcador_ins after insert on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_upd after update on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_del after delete on %I '
                     || 'referencing old table as removidas for each statement execute function marcar_mudanca_sync()', t);
      execute format('drop trigger if exists trg_sync_exclusao on %I', t);
      execute format('create trigger trg_sync_exclusao after delete on %I '
                     || 'for each row execute function registrar_exclusao_sync()', t);
    end if;
  end loop;
end $$;

-- ── 6) Índices do delta ───────────────────────────────────────────────────────────────
-- Poucos e em tabelas pequenas: cabem aqui sem risco de estourar o tempo da transação.
create index if not exists idx_cashback_plano_sync on cashback_plano (tenant_id, atualizado_em, id);
create index if not exists idx_cashback_produto_valor_sync on cashback_produto_valor (tenant_id, criado_em, id);
create index if not exists idx_cashback_movimento_sync on cashback_movimento (tenant_id, criado_em, id);
create index if not exists idx_cashback_vale_sync on cashback_vale (tenant_id, atualizado_em, id);
create index if not exists idx_fidelidade_plano_sync on fidelidade_plano (tenant_id, atualizado_em, id);
create index if not exists idx_fidelidade_ponto_sync on fidelidade_ponto (tenant_id, atualizado_em, id);
create index if not exists idx_fidelidade_resgate_sync on fidelidade_resgate (tenant_id, atualizado_em, id);
-- Usado pelo recálculo do saldo a cada movimento.
create index if not exists idx_cashback_movimento_saldo on cashback_movimento (tenant_id, telefone, tipo);
create index if not exists idx_fidelidade_ponto_saldo on fidelidade_ponto (tenant_id, plano_id, telefone) where estornado = false;
create index if not exists idx_fidelidade_resgate_saldo on fidelidade_resgate (tenant_id, plano_id, telefone);
