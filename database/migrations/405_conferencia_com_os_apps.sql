-- @cloud-only
-- 405 — "CONFERIR COM OS APPS" (R3 F4a da Gestão do catálogo; protótipo mockups/regem-conciliacao-ifood.html v8, decisão 5).
--
-- A conferência compara o cardápio do iFood (lido pelo Orzuni: `cardapio_listar` e `complementos_listar`) e o da 99 (lido
-- direto: doc 1961 `GET /v3/item/item/list`) com o cadastro do Regem, pelo código PDV. Lê o app AO ABRIR (no máximo uma
-- leitura automática por dia) e pelo botão "Ler agora" — nada de leitura de minuto em minuto. Nasce desligada: o direito
-- `conferir_apps` da empresa, ligado pela distribuição (entitlement; nenhuma linha nova aqui).
--
-- conferencia_app_leitura — a ÚLTIMA leitura de cada app em cada loja (uma linha por loja e app). `itens` e `opcoes` são o
--   cardápio do app já no formato do Regem (código, nome, grupo, preço em reais, pausado), sem foto nem segredo.
--   `lendo_desde` é a vez de quem está lendo agora: duas telas abertas juntas fazem UMA leitura (a outra recebe a leitura
--   anterior com "lendo"); vencida em 2 minutos (processo morto no meio). `erro`/`erro_em`: a última leitura que falhou —
--   a tela mostra a anterior com o aviso, e a leitura automática espera 15 minutos antes de tentar de novo.
-- conferencia_app_ignorado — o "Ignorar" da linha, por loja e app (decisão do protótipo: "Ignorar é por loja e por app, e
--   se desfaz"). `chave`: `pdv:<código>` (item ou opção com código), `app:<id no app>` (sem código no app) ou
--   `regem:<id do produto>` (só no Regem). Desfazer apaga a linha (é o "Desfazer" da tela, com auditoria).
--
-- ⚠️ SÓ NUVEM: as credenciais do Orzuni e da 99 só existem lá. O servidor da loja pula o arquivo inteiro (as duas tabelas
--    ficam em SO_NUVEM no sync-daemon) e a tela dele pede à nuvem pela rota do token de sync.
-- ⚠️ Pelo MCP do Supabase: nada que apague objeto (LIC-171). Idempotente.
-- RLS ligada e SEM política (como a 370 e a 402): fora do alcance da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists conferencia_app_leitura (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references empresa(id) on delete cascade,
  unidade_id   uuid not null references unidade(id) on delete cascade,
  canal        text not null,                        -- ifood | 99food
  lido_em      timestamptz,                          -- a última leitura que deu certo
  itens        jsonb not null default '[]'::jsonb,   -- os itens do app (formato do Regem)
  opcoes       jsonb not null default '[]'::jsonb,   -- as opções dos complementos do app
  lendo_desde  timestamptz,                          -- a vez de quem lê agora (vence em 2 min)
  erro         text,                                 -- a última leitura que falhou (frase para a tela)
  erro_em      timestamptz,
  constraint ck_conferencia_app_leitura_canal check (canal in ('ifood', '99food'))
);
create unique index if not exists uq_conferencia_app_leitura on conferencia_app_leitura (unidade_id, canal);
create index if not exists idx_conferencia_app_leitura_tenant on conferencia_app_leitura (tenant_id);
alter table conferencia_app_leitura enable row level security;

create table if not exists conferencia_app_ignorado (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  unidade_id  uuid not null references unidade(id) on delete cascade,
  canal       text not null,                         -- ifood | 99food
  tipo        text not null,                         -- item | opcao
  chave       text not null,                         -- pdv:<código> | app:<id no app> | regem:<id do produto>
  nome        text,                                  -- o nome na hora de ignorar (para a auditoria e a tela)
  criado_por  uuid,                                  -- colaborador
  criado_em   timestamptz not null default clock_timestamp(),
  constraint ck_conferencia_app_ignorado_canal check (canal in ('ifood', '99food')),
  constraint ck_conferencia_app_ignorado_tipo check (tipo in ('item', 'opcao'))
);
create unique index if not exists uq_conferencia_app_ignorado on conferencia_app_ignorado (unidade_id, canal, tipo, chave);
create index if not exists idx_conferencia_app_ignorado_tenant on conferencia_app_ignorado (tenant_id);
alter table conferencia_app_ignorado enable row level security;

-- Conferência (no mesmo Run): as 4 linhas têm de vir com `ok = true`.
select 'a tabela da leitura' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'conferencia_app_leitura' and column_name = 'lendo_desde') as ok
union all
select 'a tabela dos ignorados',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'conferencia_app_ignorado' and column_name = 'chave')
union all
select 'um por loja e app (leitura)',
       exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'uq_conferencia_app_leitura')
union all
select 'um por loja, app e chave (ignorados)',
       exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'uq_conferencia_app_ignorado');
