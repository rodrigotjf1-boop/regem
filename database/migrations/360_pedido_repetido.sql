-- 360 — PEDIDO IGUAL EM ATÉ 30 MINUTOS (pedido do dono, 03/11/2026; protótipo `mockups/regem-alteracao-pedido.html`
-- aprovado no mesmo dia — decisões 1 e 2A).
--
-- O cardápio online e o robô do WhatsApp PERGUNTAM ao cliente antes de gravar (nada a guardar). Nos canais de fora
-- (Anota AI, iFood, 99, Cardápio Web) o Regem não conversa com o cliente: o pedido entra MARCADO e o painel, o KDS e a
-- via avisam a equipe até alguém confirmar "São dois pedidos".
--
-- 1. `pedido_externo.repetido_de`: o pedido IGUAL mais antigo do mesmo cliente (o cadastro ligado ao pedido) na janela.
--    Nasce na gravação do pedido e não muda mais — sem chave estrangeira (no servidor da loja o outro pedido pode não
--    estar na janela do espelho, e a linha não pode ser recusada por isso).
-- 2. `pedido_repetido_ok`: a confirmação "São dois pedidos". UMA POR PEDIDO, só de inclusão, com o id pela chave do
--    pedido (`md5('pedido-repetido-ok' || pedido_id)::uuid` — a loja e a nuvem chegam ao mesmo id, V42). Tabela À PARTE
--    de `pedido_externo` de propósito, como a `pedido_chegada` (mig 354): o pedido sincroniza pela última escrita da
--    LINHA INTEIRA, e uma confirmação feita num lado seria apagada pela cópia "mais nova" do outro (o KDS marcou pronto,
--    o canal mudou o status). Sobe e desce: confirma-se no computador da loja ou na tela da nuvem.
-- 3. O ajuste da loja em `cardapio_config` (sincroniza nos dois sentidos, como o do "Cheguei", mig 354):
--    `pedido_repetido_ativo` (nasce LIGADO, decisão 1) e `pedido_repetido_min` (30). Sem CHECK: uma regra diferente entre
--    a nuvem e a loja envenenaria a linha no sync — o serviço valida.
--
-- NÃO é @cloud-only: o KDS, a via e o painel do servidor da loja leem daqui.
-- ⚠️ Aplicar na NUVEM ANTES do merge (V9; ERR-029: o Drizzle nomeia todas as colunas no select). Idempotente; os gatilhos
-- vão por `create or replace trigger`, sem `drop` (V9, ERR-225). `add column` sem valor padrão não reescreve a tabela.
set local lock_timeout = '5s';

alter table pedido_externo add column if not exists repetido_de uuid;

create table if not exists pedido_repetido_ok (
  id uuid primary key,                  -- md5('pedido-repetido-ok' || pedido_id)::uuid
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,                      -- a loja do pedido
  pedido_id uuid not null,              -- pedido_externo.id
  por_id uuid,                          -- quem confirmou (colaborador)
  por_nome text,                        -- o nome de quem confirmou, como a tela mostra
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Uma confirmação por pedido; o cursor do sync (tenant, updated_at, id).
create unique index if not exists uq_pedido_repetido_ok_pedido on pedido_repetido_ok (tenant_id, pedido_id);
create index if not exists idx_pedido_repetido_ok_sync on pedido_repetido_ok (tenant_id, updated_at, id);

-- O mesmo carimbo das outras tabelas sincronizadas (respeita `regem.sync`, mig 259).
create or replace trigger trg_bump_updated_at before update on pedido_repetido_ok
  for each row execute function bump_updated_at();

-- A exclusão chega ao outro lado (mig 262), e o marcador de mudança (mig 264) diz ao pull quando consultar a tabela.
-- O teste do sync lê os nomes do `array[...]`.
do $$
declare t text;
begin
  foreach t in array array['pedido_repetido_ok'] loop
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
alter table pedido_repetido_ok enable row level security;

-- O ajuste da loja (Delivery › Configurações › Operação › Atendimento › "Pedido repetido").
alter table cardapio_config add column if not exists pedido_repetido_ativo boolean not null default true;
alter table cardapio_config add column if not exists pedido_repetido_min integer not null default 30;

-- ===== Conferência (no mesmo Run): as seis linhas têm de vir com `ok = true` =====
select 'coluna pedido_externo.repetido_de (uuid)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'pedido_externo'
                  and column_name = 'repetido_de' and data_type = 'uuid') as ok
union all
select 'tabela pedido_repetido_ok',
       to_regclass(current_schema() || '.pedido_repetido_ok') is not null
union all
select 'colunas de pedido_repetido_ok (8)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'pedido_repetido_ok'
           and column_name in ('id', 'tenant_id', 'unidade_id', 'pedido_id', 'por_id', 'por_nome',
                               'created_at', 'updated_at')) = 8
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pedido_repetido_ok'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pedido_repetido_ok')
union all
select 'colunas do ajuste em cardapio_config (2)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'cardapio_config'
           and column_name in ('pedido_repetido_ativo', 'pedido_repetido_min')) = 2;
