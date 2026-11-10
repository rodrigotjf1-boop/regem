-- 392 — A pausa dos pedidos POR CANAL e POR LOJA (pedido do dono, 10/11/2026; protótipo `mockups/regem-pausa.html`, aprovado).
--
-- Até aqui a pausa (`delivery_config.pausado_ate` + `pausa_motivo`, só da rede) só mostrava a faixa no painel do
-- Delivery: o cardápio online seguia aceitando pedido, o atendente não sabia e nada ia para a auditoria. Agora cada canal
-- tem a sua pausa — o cardápio digital (o site e o atendente no WhatsApp, Instagram e Messenger), o iFood e a 99 — com o
-- motivo (um dos prontos ou escrito) e até quando. O cardápio digital fecha de verdade (o servidor recusa o pedido) e o
-- atendente lê a pausa. iFood e 99 pausam pela API de cada um numa fase seguinte; as colunas `externo_*` já ficam aqui.
--
-- POR QUE UMA TABELA PRÓPRIA, e não colunas em `delivery_config`: aquela configuração é herdada INTEIRA da rede pela loja
-- (`DeliveryService.configRaw`) — criar a linha da loja só para pausar trocaria os outros ajustes dela pelos padrões. E a
-- linha que as telas de configuração regravam não pode desfazer a pausa (ERR-175).
--
-- UMA LINHA POR EMPRESA, LOJA E CANAL: o `id` sai da chave (`idPausaDoCanal`, a conta do `uuidDeChave`:
-- md5('pausa_canal' || empresa || loja || canal)), então a nuvem e o servidor da loja geram a MESMA linha e o sync resolve
-- pela última escrita (`updated_at`). Reabrir grava `ate = null`; a linha não se apaga. `unidade_id` nulo = a empresa toda
-- (o cardápio sem loja, que é o caso de hoje). Sem `check` nos códigos de canal e de motivo de propósito: a linha de uma
-- versão mais nova (um motivo novo) não pode travar o sync de um servidor de loja mais antigo — quem confere é o serviço.
--
-- NÃO é @cloud-only: o painel do servidor da loja pausa e lê aqui. Sincroniza nos dois sentidos (sync-config 'ambos' +
-- PUSH_TABLES do daemon). ⚠️ Aplicar na NUVEM ANTES do merge: o cardápio online passa a ler esta tabela. Idempotente; os
-- gatilhos vão por `create or replace trigger` (V9).

create table if not exists pausa_canal (
  id uuid primary key,
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  canal text not null,            -- cardapio | ifood | food99
  ate timestamptz,                -- até quando; nulo ou no passado = aberto
  motivo text,                    -- pedidos | entregador | ingrediente | cozinha | energia | fechando | outro
  motivo_texto text,              -- o que o gestor escreveu no "Outro motivo…" (até 80 letras; o cliente lê)
  pausado_em timestamptz,
  pausado_por uuid,               -- quem pausou (colaborador)
  pausado_por_nome text,
  externo_situacao text,          -- iFood e 99 (fase da API): o que a plataforma respondeu
  externo_id text,                -- iFood: o id da interrupção (é por ele que se reabre)
  externo_erro text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A chave de negócio também no índice: o id já sai dela, isto é a segunda trava contra a linha repetida (V24).
create unique index if not exists ux_pausa_canal_chave
  on pausa_canal (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), canal);
create index if not exists idx_pausa_canal_sync on pausa_canal (tenant_id, updated_at, id);

-- A mudança propaga pelo sync: o mesmo carimbo das outras tabelas sincronizadas (respeita `regem.sync`, mig 259).
create or replace trigger trg_bump_updated_at before update on pausa_canal
  for each row execute function bump_updated_at();

-- A exclusão (a empresa apagada leva a linha junto) chega ao outro lado (mig 262), e o marcador de mudança (mig 264) diz
-- ao pull quando consultar a tabela. O teste do sync lê os nomes do `array[...]`.
do $$
declare t text;
begin
  foreach t in array array['pausa_canal'] loop
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
alter table pausa_canal enable row level security;

-- ===== Conferência (no mesmo Run): as cinco linhas têm de vir com `ok = true` =====
select 'tabela pausa_canal' as objeto,
       to_regclass(current_schema() || '.pausa_canal') is not null as ok
union all
select 'colunas (15)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'pausa_canal'
           and column_name in ('id', 'tenant_id', 'unidade_id', 'canal', 'ate', 'motivo', 'motivo_texto', 'pausado_em',
                               'pausado_por', 'pausado_por_nome', 'externo_situacao', 'externo_id', 'externo_erro',
                               'created_at', 'updated_at')) = 15
union all
select 'índice da chave',
       to_regclass(current_schema() || '.ux_pausa_canal_chave') is not null
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pausa_canal'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pausa_canal');
