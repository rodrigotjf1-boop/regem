-- 412 — Os avisos do KDS GUARDADOS (auditoria do KDS de 11/11/2026, onda 3 — A3, A7, A11; o Farol na cozinha; protótipo
-- aprovado pelo dono, `mockups/regem-kds-cozinha.html`, abas 1 e 3: "Histórico de 90 dias (tabela alerta_kds da onda 3)").
--
-- Até aqui cada aviso do rodapé do KDS era só um evento ao vivo: a tela recarregada perdia o urgente que esperava o
-- "Ciente", o "Ciente" de uma tela não tirava o aviso das outras, os disparos automáticos não ficavam registrados (A11) e
-- o "Testar" feito na nuvem não chegava ao KDS do servidor da loja (A3). Agora cada aviso que vai às telas vira uma linha
-- daqui — os alertas cadastrados, os de estoque e de gestão, e os do FAROL (câmeras), que a nuvem busca no transporte do
-- Farol (`POST /v1/envios/reivindicar`, contrato `contratos/transporte-dos-alertas.json` do Farol).
--
--  • `lado` = onde o aviso nasceu (nuvem | loja). Os dois lados rodam o motor dos alertas cadastrados: cada lado guarda e
--    mostra o SEU — o histórico de uma tela é o do lado dela, sem nada em dobro.
--  • `entregar_na_loja` = o aviso da NUVEM que o servidor da loja também mostra quando a linha desce (o Farol, que só a
--    nuvem busca, e o "Testar" feito pelo app na nuvem). Os demais da nuvem ficam na nuvem.
--  • O "Ciente" (`ciente_em`, quem e de qual KDS) vale para todas as telas e, uma vez dado, não se desfaz pela
--    sincronização (a precedência fica no `sync-daemon` e no envio para a nuvem).
--  • Guardado por 90 dias (a limpeza roda nos dois lados; a exclusão sincroniza).
--
-- Sincroniza nos DOIS sentidos (cursor `updated_at`, filtrada pela loja): os gatilhos de carimbo, de exclusão e do
-- marcador, como toda tabela que sincroniza. ⚠️ Aplicar na NUVEM antes do merge; na loja vai com o `.zip`.
set local lock_timeout = '5s';

create table if not exists alerta_kds (
  id uuid primary key,                         -- quem cria dá o id (o do Farol sai do id do envio: o reenvio não repete)
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,                             -- a loja; nulo = a empresa inteira
  tipo text not null default 'loja',           -- loja | farol | pausa | estoque | chegou | gestao (common/avisos-do-kds)
  origem text,                                 -- de onde veio, como o histórico mostra ("Farol · crítico")
  titulo text not null,
  detalhe text,
  prioridade text not null default 'alta',     -- danger | alta | info | ok
  duracao_seg integer not null default 60,     -- quanto tempo fica no rodapé (o que não fica até o "Ciente")
  fica boolean not null default false,         -- fica até alguém tocar "Ciente"
  kds_ids uuid[],                              -- para quais KDS; nulo = todos da loja
  ref text,                                    -- o que originou (farol:<envio>, alerta:<cadastro>, …)
  lado text not null default 'nuvem',          -- nuvem | loja: onde nasceu
  entregar_na_loja boolean not null default false,
  criado_em timestamptz not null default clock_timestamp(),
  ciente_em timestamptz,
  ciente_por_id uuid,
  ciente_por_nome text,
  ciente_kds_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_alerta_kds_loja on alerta_kds (tenant_id, unidade_id, criado_em desc);
create index if not exists idx_alerta_kds_pendente on alerta_kds (tenant_id, criado_em)
  where fica and ciente_em is null;
create index if not exists idx_alerta_kds_descer on alerta_kds (criado_em)
  where lado = 'nuvem' and entregar_na_loja;
create index if not exists idx_alerta_kds_sync on alerta_kds (tenant_id, updated_at, id);

create or replace trigger trg_bump_updated_at before update on alerta_kds
  for each row execute function bump_updated_at();
do $$
declare t text;
begin
  foreach t in array array['alerta_kds'] loop
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
alter table alerta_kds enable row level security;

comment on table alerta_kds is
  'Os avisos que foram ao rodapé do KDS (alertas cadastrados, estoque, gestão, Farol), com o "Ciente"; 90 dias (mig 412).';

-- Conferência (mesmo Run): tudo `ok`.
select 'tabela alerta_kds' as objeto, to_regclass(current_schema() || '.alerta_kds') is not null as ok
union all
select 'colunas de alerta_kds (21)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'alerta_kds'
           and column_name in ('id', 'tenant_id', 'unidade_id', 'tipo', 'origem', 'titulo', 'detalhe', 'prioridade',
                               'duracao_seg', 'fica', 'kds_ids', 'ref', 'lado', 'entregar_na_loja', 'criado_em',
                               'ciente_em', 'ciente_por_id', 'ciente_por_nome', 'ciente_kds_id', 'created_at',
                               'updated_at')) = 21
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'alerta_kds'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'alerta_kds');
