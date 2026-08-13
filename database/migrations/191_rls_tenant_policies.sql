-- @cloud-only
-- =====================================================================================
-- RLS por tenant — defesa em profundidade (Fase 3: policies).
-- =====================================================================================
-- Cria, para toda tabela do schema public:
--   • com coluna tenant_id  → policy `tenant_isolation` (TO regem_rls): só enxerga/grava
--     linhas cujo tenant_id = current_setting('app.tenant'). GUC ausente → NULL → nada.
--   • sem tenant_id (tabelas globais/referência) → policy `app_global_read` (TO regem_rls):
--     liberadas para o app (protegidas por RBAC na aplicação). Escopadas ao role regem_rls,
--     então a API REST anônima (role anon) continua BLOQUEADA (RLS on, sem policy p/ anon).
--
-- INERTE por padrão: as policies são `TO regem_rls`. Enquanto o app conectar como
-- regem_app (BYPASSRLS), nada muda. Só passam a valer quando DATABASE_URL apontar para
-- regem_rls (NOBYPASSRLS) E RLS_ENABLED=true no backend. Ver docs/rls-multitenant.md.
--
-- ORDEM: rode DEPOIS de criar o role regem_rls (o bloco checa e sai com aviso se faltar).
-- Idempotente: pode rodar quantas vezes quiser.
-- =====================================================================================
do $$
declare
  r record;
begin
  if not exists (select 1 from pg_roles where rolname = 'regem_rls') then
    raise notice 'Role regem_rls não existe ainda — crie-o antes de ativar (docs/rls-multitenant.md). Nenhuma policy criada.';
    return;
  end if;

  for r in
    select c.relname as tbl,
           exists (
             select 1 from information_schema.columns col
             where col.table_schema = 'public'
               and col.table_name = c.relname
               and col.column_name = 'tenant_id'
           ) as tem_tenant
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'r'                        -- só tabelas comuns
      and c.relname not like 'drizzle%'           -- ignora meta de migrations
  loop
    execute format('alter table public.%I enable row level security', r.tbl);
    if r.tem_tenant then
      execute format('drop policy if exists tenant_isolation on public.%I', r.tbl);
      execute format(
        $f$create policy tenant_isolation on public.%I to regem_rls
             using (tenant_id = current_setting('app.tenant', true)::uuid)
             with check (tenant_id = current_setting('app.tenant', true)::uuid)$f$,
        r.tbl
      );
    else
      execute format('drop policy if exists app_global_read on public.%I', r.tbl);
      execute format(
        'create policy app_global_read on public.%I to regem_rls using (true) with check (true)',
        r.tbl
      );
    end if;
  end loop;

  raise notice 'RLS: policies (re)criadas para o role regem_rls.';
end $$;
