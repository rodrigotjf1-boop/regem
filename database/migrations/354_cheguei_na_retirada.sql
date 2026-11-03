-- 354 — "Cheguei" na retirada (Onda 3; protótipo `mockups/regem-relacionamento.html` aprovado pelo dono em 03/11/2026).
--
-- O cliente que pediu para RETIRAR avisa que chegou: pelo botão na página do pedido (cardápio online), pelo botão
-- "Cheguei" do aviso de pronto no WhatsApp ou escrevendo "cheguei". A equipe vê "Clientes esperando" em PDV · Balcão ›
-- Retirada / Encomendas, a etiqueta no cartão do KDS e o aviso em qualquer tela.
--
-- 1. `pedido_chegada`: UMA LINHA POR PEDIDO (o `id` É o id do pedido). Tabela À PARTE de `pedido_externo` de propósito,
--    pelo mesmo motivo da `pedido_logistica` (mig 294): `pedido_externo` sincroniza nos dois sentidos pela última escrita
--    da LINHA INTEIRA — a loja mexendo no pedido (o KDS marca pronto) antes de puxar a novidade devolveria a coluna velha
--    e apagaria o "cheguei" na nuvem. Só a NUVEM escreve aqui (o cardápio online e o WhatsApp rodam lá) e a tabela só
--    DESCE para o servidor da loja. Sem chave estrangeira para `pedido_externo` (como a 294): no servidor da loja o pedido
--    antigo pode não estar na janela do espelho, e a linha daqui não pode ser recusada por isso.
-- 2. Os ajustes da loja em `cardapio_config` (sincroniza nos dois sentidos, como o código de entrega da 348):
--    `cheguei_ativo` (nasce DESLIGADO), `cheguei_perguntar_onde`, `cheguei_todas_telas` e `cheguei_de_novo_min`.
--    Sem CHECK nas colunas novas: uma regra diferente entre a nuvem e a loja envenenaria a linha no sync — o serviço
--    valida (3, 5 ou 10 min).
--
-- NÃO é @cloud-only: a Retirada, o KDS e o sino do servidor da loja leem daqui (e pedem à nuvem a chegada mais nova).
-- ⚠️ Aplicar na NUVEM ANTES do merge. Idempotente; os gatilhos vão por `create or replace trigger` (V9), sem `drop`.
set local lock_timeout = '5s';

create table if not exists pedido_chegada (
  id uuid primary key,                  -- o id do pedido (pedido_externo.id)
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,                      -- a loja do pedido
  chegou_em timestamptz not null,       -- o primeiro "cheguei"
  de_novo_em timestamptz,               -- o último "avisar de novo" do cliente
  onde text,                            -- 'balcao' | 'porta' | null (não disse)
  obs text,                             -- "como te achar" ou o que o cliente escreveu junto
  origem text not null,                 -- 'cardapio' | 'whatsapp'
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- O cursor do sync (tenant, updated_at, id) e as chegadas do dia de uma empresa.
create index if not exists idx_pedido_chegada_sync on pedido_chegada (tenant_id, updated_at, id);
create index if not exists idx_pedido_chegada_dia on pedido_chegada (tenant_id, chegou_em desc);

-- A mudança propaga pelo sync: o mesmo carimbo das outras tabelas sincronizadas (respeita `regem.sync`, mig 259).
create or replace trigger trg_bump_updated_at before update on pedido_chegada
  for each row execute function bump_updated_at();

-- A exclusão chega ao outro lado (mig 262), e o marcador de mudança (mig 264) diz ao pull quando consultar a tabela.
-- O teste do sync lê os nomes do `array[...]`.
do $$
declare t text;
begin
  foreach t in array array['pedido_chegada'] loop
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
alter table pedido_chegada enable row level security;

-- Os ajustes da loja (Delivery › Configurações › Atendimento › "Retirada · cliente chegou").
alter table cardapio_config add column if not exists cheguei_ativo boolean not null default false;
alter table cardapio_config add column if not exists cheguei_perguntar_onde boolean not null default true;
alter table cardapio_config add column if not exists cheguei_todas_telas boolean not null default true;
alter table cardapio_config add column if not exists cheguei_de_novo_min integer not null default 5;

-- ===== Conferência (no mesmo Run): as cinco linhas têm de vir com `ok = true` =====
select 'tabela pedido_chegada' as objeto,
       to_regclass(current_schema() || '.pedido_chegada') is not null as ok
union all
select 'colunas de pedido_chegada (10)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'pedido_chegada'
           and column_name in ('id', 'tenant_id', 'unidade_id', 'chegou_em', 'de_novo_em', 'onde', 'obs', 'origem',
                               'created_at', 'updated_at')) = 10
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pedido_chegada'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pedido_chegada')
union all
select 'colunas do ajuste em cardapio_config (4)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'cardapio_config'
           and column_name in ('cheguei_ativo', 'cheguei_perguntar_onde', 'cheguei_todas_telas',
                               'cheguei_de_novo_min')) = 4;
