-- 338 — O mapa dos entregadores num KDS, escolhido pelo painel do Delivery (cozinha em estações, entrega 5; dono, 21/10/2026).
--
-- Em Delivery › Mapa ao vivo, o gestor marca as telas de KDS que trocam os pedidos pelo mapa dos entregadores (pode ser
-- mais de uma; a desmarcada volta aos pedidos). Até aqui o KDS só mostrava o mapa por escolha feita no próprio aparelho.
--
-- POR QUE UMA TABELA PRÓPRIA, e não uma coluna em `equipamento`: o uso do aparelho grava na linha do equipamento (último
-- uso, ping) e, no sync de dois sentidos pela data, a cópia "mais nova" da loja desfaria a escolha feita no painel da
-- nuvem (ERR-235). Nesta tabela só o painel grava.
--
-- UMA LINHA POR KDS: o `id` É o id do KDS (equipamento). A nuvem e o servidor da loja geram a MESMA linha para o mesmo KDS
-- e o sync resolve pela última escrita (`updated_at`). A linha não se apaga: tirar do KDS grava `mostra_mapa = false`. Ela
-- só some com o próprio KDS (cascata), e essa exclusão viaja pelo `sync_exclusao`.
--
-- A chave da loja continua valendo (mig 293): com o "mapa no KDS" desligado em Delivery › Configurações, o KDS marcado
-- mostra os pedidos até o gestor ligar.
--
-- NÃO é @cloud-only: o KDS da rede da loja lê a marca no servidor da loja. Sincroniza nos dois sentidos (sync-config
-- 'ambos' + PUSH_TABLES do daemon). ⚠️ Aplicar na NUVEM ANTES do merge: a lista das telas de KDS
-- (`GET /producao/kds/telas`) passa a ler esta tabela. Idempotente; os gatilhos vão por `create or replace trigger` (V9).

create table if not exists kds_tela_ajuste (
  id uuid primary key references equipamento(id) on delete cascade, -- o próprio KDS
  tenant_id uuid not null references empresa(id) on delete cascade,
  mostra_mapa boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_kds_tela_ajuste_sync on kds_tela_ajuste (tenant_id, updated_at, id);

-- A mudança propaga pelo sync: o mesmo carimbo das outras tabelas sincronizadas (respeita `regem.sync`, mig 259).
create or replace trigger trg_bump_updated_at before update on kds_tela_ajuste
  for each row execute function bump_updated_at();

-- A exclusão (o KDS apagado leva a linha junto) chega ao outro lado (mig 262), e o marcador de mudança (mig 264) diz ao
-- pull quando consultar a tabela. O teste do sync lê os nomes do `array[...]`.
do $$
declare t text;
begin
  foreach t in array array['kds_tela_ajuste'] loop
    execute format('create or replace trigger trg_sync_exclusao after delete on %I '
                   || 'for each row execute function registrar_exclusao_sync()', t);
    execute format('create or replace trigger trg_sync_marcador_ins after insert on %I '
                   || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
    execute format('create or replace trigger trg_sync_marcador_upd after update on %I '
                   || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
    execute format('create or replace trigger trg_sync_marcador_del after delete on %I '
                   || 'referencing old table as removidas for each statement execute function marcar_mudanca_sync()', t);
  end loop;
end $$;

-- Só o app lê: sem política, a API do Supabase (anon/authenticated) não enxerga nada.
alter table kds_tela_ajuste enable row level security;

-- ===== Conferência (no mesmo Run): as quatro linhas têm de vir com `ok = true` =====
select 'tabela kds_tela_ajuste' as objeto,
       to_regclass(current_schema() || '.kds_tela_ajuste') is not null as ok
union all
select 'colunas (5)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'kds_tela_ajuste'
           and column_name in ('id', 'tenant_id', 'mostra_mapa', 'created_at', 'updated_at')) = 5
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'kds_tela_ajuste'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'kds_tela_ajuste');
