-- 425 — Área de entrega DESENHADA NO MAPA (15/11/2026, pedido do dono; protótipo `mockups/regem-area-entrega-mapa.html`
-- aprovado no mesmo dia): além de "por bairro" e "por distância", a loja desenha no mapa quantas áreas quiser, cada uma com a
-- taxa, o tempo de entrega, o pedido mínimo e o frete grátis dela; o endereço fora de todas (ou só em área pausada) não é
-- aceito. O modo vai em `cardapio_config.area_modo = 'mapa'` (texto, sem trava no banco — nada a mudar lá).
--
-- ⚠️ NÃO é @cloud-only: o painel de Delivery do servidor da loja lê e grava as áreas, como os bairros (mig 276). Aplicar nos
--    dois bancos. Idempotente. Antes do merge.
--
-- A tabela sincroniza nos DOIS sentidos, como `cardapio_bairro` (gravada por apagar-e-inserir ao salvar a lista): leva o
-- carimbo `atualizado_em`, o gatilho de exclusão (a área apagada não ressuscita do outro lado) e o marcador de mudança.
-- Gatilhos com `create or replace trigger` (migration pelo MCP sem `drop` — LIC-171).

create table if not exists cardapio_area_entrega (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  nome text not null,
  -- Os cantos da área, em ordem: [[lat, lng], ...] — de 3 a 300 pontos (o serviço confere).
  poligono jsonb not null,
  taxa numeric(10,2) not null default 0,
  tempo_min integer,
  tempo_max integer,
  pedido_minimo numeric(10,2),
  frete_gratis_acima numeric(10,2),
  cor text,
  ativo boolean not null default true,
  -- Onde duas áreas se cruzam, vale a de MENOR ordem (a de cima da lista).
  ordem integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists idx_cardapio_area_entrega_tenant on cardapio_area_entrega (tenant_id, ordem);
create index if not exists idx_cardapio_area_entrega_sync on cardapio_area_entrega (tenant_id, atualizado_em, id);

-- Os gatilhos no formato da 276 (a lista em `array[...]`, que o `sync-config.spec` lê para conferir a cobertura).
do $$
declare t text;
begin
  foreach t in array array['cardapio_area_entrega'] loop
    execute format('create or replace trigger trg_bump_atualizado_em before update on %I '
                   || 'for each row execute function bump_atualizado_em()', t);
    execute format('create or replace trigger trg_sync_marcador_ins after insert on %I '
                   || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
    execute format('create or replace trigger trg_sync_marcador_upd after update on %I '
                   || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
    execute format('create or replace trigger trg_sync_marcador_del after delete on %I '
                   || 'referencing old table as removidas for each statement execute function marcar_mudanca_sync()', t);
    execute format('create or replace trigger trg_sync_exclusao after delete on %I '
                   || 'for each row execute function registrar_exclusao_sync()', t);
  end loop;
end $$;

-- Conferência no MESMO Run: `ok` tem de vir true — a tabela com as 15 colunas, os 2 índices e os 5 gatilhos.
select (x.colunas = 15 and x.indices = 2 and x.gatilhos = 5) as ok, x.*
  from (
    select
      (select count(*) from information_schema.columns
        where table_schema = current_schema() and table_name = 'cardapio_area_entrega') as colunas,
      (select count(*) from pg_indexes
        where schemaname = current_schema() and tablename = 'cardapio_area_entrega'
          and indexname in ('idx_cardapio_area_entrega_tenant', 'idx_cardapio_area_entrega_sync')) as indices,
      (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
        where c.relname = 'cardapio_area_entrega' and not t.tgisinternal
          and t.tgname in ('trg_bump_atualizado_em', 'trg_sync_marcador_ins', 'trg_sync_marcador_upd', 'trg_sync_marcador_del', 'trg_sync_exclusao')) as gatilhos
  ) x;
