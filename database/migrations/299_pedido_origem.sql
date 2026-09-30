-- @cloud-only
-- 299_pedido_origem.sql — De onde veio o pedido do CARDÁPIO (trilha C, C3a — PR4): a campanha,
-- o anúncio e o código do clique que o cliente trouxe no link. A API de integração devolve isso
-- no campo `origem` de `GET /api/v1/integracao/pedidos`.
--
-- O QUE ENTRA
--   1. `pedido_origem`: uma linha por pedido do cardápio que chegou por link marcado, gravada logo
--      depois do pedido — e só na loja que mede anúncios (token ativo com `pedidos.ler` que lê as
--      vendas dessa loja). O cliente vê o aviso no checkout e pode recusar ("Não registrar");
--      pedido da MESA nunca registra (sai sem passar pelo checkout, sem aviso).
--   2. Um gatilho POR COMANDO, só de INSERÇÃO, que anota o pedido na fila da mig 296
--      (`integracao_mudanca`): a venda ganha versão nova com a origem. O EXPURGO dos códigos de
--      clique aos 90 dias (job da nuvem) é UPDATE e não gera versão (decisão do dono, 29/09/2026).
--
-- Sem chave estrangeira para `pedido_externo`, de propósito (como a 298 fez com `cupom`): é tabela
-- quente que sincroniza — a FK poria trava e ação em cascata nela. A linha de pedido apagado é
-- removida pelo mesmo job diário.
--
-- ⚠️ NUNCA PODE FALHAR: o corpo do gatilho roda num bloco com `exception when others` (vira AVISO
--    no log do Postgres; a reconciliação diária cobre o que escapar) e com `lock_timeout` curto.
--    A gravação em si também nunca derruba o pedido (o serviço registra o motivo e segue).
-- ⚠️ SÓ NUVEM: o pedido online nasce na nuvem (`CardapioModule` não roda na loja). O servidor da
--    loja pula o arquivo inteiro; a tabela não existe lá e não entra no sincronismo.
-- ⚠️ DEPENDE da 295 e da 296. Aplicar na NUVEM ANTES do merge. Não trava tabela de venda: a
--    tabela e o gatilho são novos.
-- Idempotente (if not exists / create or replace / drop … if exists).
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null
     or to_regclass(current_schema() || '.integracao_mudanca') is null then
    raise exception 'A 299 depende da 295 e da 296 (tokens e fila da integração): aplique-as antes.';
  end if;
end $$;

create table if not exists pedido_origem (
  pedido_id         uuid primary key,              -- pedido_externo.id (sem FK: ver acima)
  tenant_id         uuid not null,
  unidade_id        uuid,                          -- loja do cardápio (nulo = cardápio da rede)
  capturado_em      timestamptz not null,          -- quando o cliente chegou pelo link
  lk                text,                          -- link rastreável do Liame
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  campaign_id       text,
  adset_id          text,
  adgroup_id        text,
  ad_id             text,
  gclid             text,                          -- códigos de clique: apagados aos 90 dias
  gbraid            text,
  wbraid            text,
  fbclid            text,
  criado_em         timestamptz not null default now(),
  ids_expurgados_em timestamptz                    -- quando o job apagou os códigos de clique
);
-- Job diário: o que ainda tem código de clique, do mais antigo para o mais novo.
create index if not exists idx_pedido_origem_expurgo
  on pedido_origem (criado_em)
  where ids_expurgados_em is null;

-- Dado de venda: fora do alcance da API REST anônima (o app usa um papel que atravessa a RLS).
alter table pedido_origem enable row level security;

-- Origem gravada → a venda do pedido muda (versão nova com `origem`). Só para empresa CONECTADA
-- (token ativo, mig 295); sem nenhuma, sai na hora.
create or replace function integracao_mudou_origem() returns trigger
language plpgsql
set lock_timeout = '2s'
as $$
declare
  conectadas uuid[];
begin
  begin
    if not exists (select 1 from novas) then
      return null; -- o `on conflict do nothing` que não inseriu nada
    end if;
    select array_agg(distinct t.tenant_id) into conectadas
      from integracao_token_loja t where t.revogado_em is null;
    if conectadas is null then
      return null;
    end if;
    insert into integracao_mudanca (tenant_id, recurso, recurso_id)
    select n.tenant_id, 'pedido', n.pedido_id from novas n where n.tenant_id = any(conectadas);
  exception when others then
    raise warning 'integracao_versao: mudança em % não registrada (%: %)', tg_table_name, sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists trg_integracao_ins on pedido_origem;
create trigger trg_integracao_ins after insert on pedido_origem
  referencing new table as novas for each statement execute function integracao_mudou_origem();

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`.
select 'tabela pedido_origem' as objeto,
       to_regclass(current_schema() || '.pedido_origem') is not null as ok
union all
select 'colunas da pedido_origem (20)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'pedido_origem') = 20
union all
select 'índice do expurgo',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'pedido_origem'
                  and indexname = 'idx_pedido_origem_expurgo')
union all
select 'gatilho de inserção',
       exists (select 1 from pg_trigger g
                 join pg_class c on c.oid = g.tgrelid
                 join pg_namespace s on s.oid = c.relnamespace
                where s.nspname = current_schema() and not g.tgisinternal
                  and g.tgname = 'trg_integracao_ins' and c.relname = 'pedido_origem')
union all
select 'RLS ligada',
       exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
                where s.nspname = current_schema() and c.relname = 'pedido_origem' and c.relrowsecurity)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
