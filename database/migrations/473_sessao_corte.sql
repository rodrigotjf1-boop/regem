-- 473 — "PERDI O CELULAR": encerrar TODAS as sessões do Regem de uma pessoa (Mister versão 6, fase M6c; plano aprovado em
-- 20/11/2026, `docs/plano-mister.md` § "Versão 6", peça A5; protótipo `mockups/regem-mister-v6.html`, Mister › Pessoas e o
-- diálogo "Perdi o celular"). A 472 é a das regras do Mister (M6e); a 474 é de outra sessão (o Clube).
--
-- "Sair" (mig 457) encerra UMA sessão, pelo número dela. Quem perdeu o celular não tem o celular para sair: o corte vale
-- para a PESSOA — todo token dela emitido ANTES do corte deixa de valer, em todos os aparelhos (o app logado no celular
-- perdido, o navegador de outro computador). Entrar de novo com a senha (ou o PIN) emite um token depois do corte e vale.
--
-- sessao_corte — UMA LINHA POR PESSOA (o `id` É o id do colaborador; o corte novo sobe o `desde`, nunca o desce):
--   desde               — os tokens emitidos antes disto (o `iat`) são recusados pela guarda das rotas e pelo tempo real
--   motivo              — 'perdi_celular' (por enquanto o único; o texto é do serviço)
--   por                 — quem cortou: 'pessoa' (a própria), 'presidente' ou 'dms' (o suporte, pelo console)
--   por_colaborador_id  — o presidente que cortou (null para a própria pessoa e para o suporte)
--
-- Tabela À PARTE de `colaborador` de propósito, pelo motivo da `pedido_chegada` (mig 354): `colaborador` sincroniza nos
-- dois sentidos pela última escrita da LINHA INTEIRA — a loja mexendo na pessoa antes de puxar a novidade devolveria a
-- coluna velha e apagaria o corte na nuvem. Só a NUVEM escreve aqui (Mister › Pessoas e o console rodam lá) e a tabela só
-- DESCE para o servidor da loja, que passa a recusar ali também o token emitido antes do corte. Sem CHECK nas colunas (uma
-- regra diferente entre os lados envenenaria a linha no sync) e sem chave estrangeira para `colaborador` (como a 354).
--
-- NÃO é @cloud-only: a guarda do servidor da loja lê daqui. ⚠️ Aplicar na NUVEM ANTES do merge. Idempotente; os gatilhos
-- vão por `create or replace trigger` (V9, LIC-171), sem `drop`.
set local lock_timeout = '5s';

create table if not exists sessao_corte (
  id                  uuid primary key,          -- o id da pessoa (colaborador.id)
  tenant_id           uuid not null references empresa(id) on delete cascade,
  desde               timestamptz not null,
  motivo              text not null,
  por                 text not null,
  por_colaborador_id  uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- O cursor do sync (tenant, updated_at, id) e o aviso aos presidentes (os cortes das últimas 24 h).
create index if not exists idx_sessao_corte_sync on sessao_corte (tenant_id, updated_at, id);
create index if not exists idx_sessao_corte_desde on sessao_corte (desde);

-- A mudança propaga pelo sync: o mesmo carimbo das outras tabelas sincronizadas (respeita `regem.sync`, mig 259).
create or replace trigger trg_bump_updated_at before update on sessao_corte
  for each row execute function bump_updated_at();

-- A exclusão chega ao outro lado (mig 262), e o marcador de mudança (mig 264) diz ao pull quando consultar a tabela.
-- O teste do sync lê os nomes do `array[...]`.
do $$
declare t text;
begin
  foreach t in array array['sessao_corte'] loop
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
alter table sessao_corte enable row level security;

comment on table sessao_corte is '"Perdi o celular" (mig 473, Mister v6 M6c): os tokens da pessoa emitidos antes de `desde` não valem — a nuvem escreve, desce à loja';

-- ===== Conferência (no mesmo Run): as quatro linhas têm de vir com `ok = true` =====
select 'tabela sessao_corte' as objeto,
       to_regclass(current_schema() || '.sessao_corte') is not null as ok
union all
select 'colunas de sessao_corte (8)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'sessao_corte'
           and column_name in ('id', 'tenant_id', 'desde', 'motivo', 'por', 'por_colaborador_id', 'created_at', 'updated_at')) = 8
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'sessao_corte'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'sessao_corte');
