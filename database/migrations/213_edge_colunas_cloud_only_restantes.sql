-- 213_edge_colunas_cloud_only_restantes.sql — colunas/tabelas que eram @cloud-only
-- mas SÃO LIDAS por código executado no EDGE (queries com .select().from(tabela)
-- materializam TODAS as colunas do schema; ou sql`... from tabela` sem try/catch).
-- Sem isto o edge quebra com `column/relation does not exist`. NÃO cloud-only:
-- roda tanto na nuvem (no-op, já existem lá) quanto no edge. Idempotente.
--
-- Landmines cobertos (análise 3-agentes 25/08/2026):
--  1) empresa.suporte_bloqueado (mig 170, cloud-only) — empresa.service.findAll/findOne
--     fazem .select().from(empresa) e o controller NÃO é @CloudOnly → GET /empresas
--     quebrava no edge.
--  2) cardapio_evento (mig 196, cloud-only) — cliente.service.crmFunil faz
--     sql`... from cardapio_evento` SEM try/catch, exposto por cliente-admin @Get('funil')
--     (NÃO @CloudOnly). O fix #343 só cobriu a ESCRITA (registrarEvento); a LEITURA ficou.
--  3) suporte_sessao (mig 170) — defensivo; jwt-guard.estadoSuporte poderia tocá-la.

alter table empresa add column if not exists suporte_bloqueado boolean not null default false;

create table if not exists cardapio_evento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  token text not null,
  sessao text not null,
  tipo text not null,        -- view_menu | add_carrinho | checkout | pagamento | pedido
  meta jsonb,
  criado_em timestamptz not null default now()
);
create index if not exists idx_cardapio_evento_funil on cardapio_evento (tenant_id, criado_em);
create index if not exists idx_cardapio_evento_sessao on cardapio_evento (token, sessao);

-- Defensivo: suporte_sessao (mig 170, DDL idêntico). Só o ramo de token de suporte lê;
-- nunca no edge hoje, mas materialização futura de select().from() poderia tocar.
-- Barato garantir. FK para empresa (existe no edge).
create table if not exists suporte_sessao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  tecnico_id uuid not null,
  tecnico_nome text,
  motivo text,
  ip text,
  iniciada_em timestamptz not null default now(),
  expira_em timestamptz not null,
  encerrada_em timestamptz,
  encerrada_por text
);
create index if not exists ix_suporte_sessao_tenant on suporte_sessao (tenant_id, iniciada_em desc);
create index if not exists ix_suporte_sessao_ativa on suporte_sessao (id) where encerrada_em is null;
