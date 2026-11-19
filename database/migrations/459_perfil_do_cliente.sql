-- @cloud-only
-- 459 · PERFIL DO CLIENTE — a base (F1a do `docs/plano-perfil-cliente.md`, plano aprovado pelo dono em 19/11/2026 com as
-- decisões recomendadas D1–D15; protótipo `mockups/regem-perfil-cliente.html`). Só NUVEM: o perfil é calculado e servido
-- pela nuvem (o robô, as campanhas e o cardápio moram lá); a loja não tem as tabelas novas (SO_NUVEM no sync-daemon).
--
-- O que entra:
--   cliente_perfil — UMA linha por cliente DIRETO da loja (iFood e 99 ficam fora — D1), recalculada pela rotina noturna
--     do módulo "Perfil do cliente" (nasce desligado — D10): o segmento RFM (1–3 por letra, como a Klaviyo), o ticket
--     ajustado (encolhido para a média da loja), o ritmo (intervalo habitual, próximo previsto, atraso contra o ritmo do
--     próprio cliente), a faixa e o dia habituais (dia de operação), a confiança, as etiquetas (com o porquê em
--     `camadas`) e o resto das camadas (gosto, reclamações agrupadas e avaliações — D13) em `camadas` (jsonb).
--   cliente_escolha — as ESCOLHAS do cliente sobre os próprios dados (D11/D15: caixas desmarcadas): recomendações
--     personalizadas, atendimento personalizado, "não quero ser analisado" e a confirmação dos 18 anos. Só inclusão (o
--     histórico prova o que foi mostrado e quando — LGPD art. 8º §2º); o estado é a última de cada escolha.
--   cliente_declarado — o que o cliente CONTOU (zero-party): time, "respostas curtas", "prefere áudio", "gostaria de
--     encontrar…" (D14) e a alergia que ELE pediu para guardar (dado de saúde — art. 11; nunca inferida). Uma linha por
--     cliente e chave; o cliente corrige.
--   perfil_cliente_execucao — a última volta da rotina noturna por empresa (V104: a cadência longa se guarda no banco).
--
-- `criado_em`/`em` pelo `clock_timestamp()` (V9, ERR-379). RLS ligada e SEM política, como a 453 (o servidor usa um papel
-- que atravessa a RLS). Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists cliente_perfil (
  cliente_id          uuid primary key references cliente(id) on delete cascade,
  tenant_id           uuid not null references empresa(id) on delete cascade,
  unidade_id          uuid,
  pedidos_diretos     integer not null default 0,
  primeiro_pedido_em  timestamptz,
  ultimo_pedido_em    timestamptz,
  segmento            text,
  rfm                 text,
  ticket_medio        numeric(12,2),
  ticket_ajustado     numeric(12,2),
  intervalo_dias      numeric(8,2),
  proximo_previsto    date,
  atraso              numeric(8,2),
  faixa_habitual      text,
  dia_habitual        smallint,
  confianca           text not null default 'baixa',
  etiquetas           text[] not null default '{}',
  camadas             jsonb not null default '{}'::jsonb,
  calculado_em        timestamptz not null default clock_timestamp(),
  versao              smallint not null default 1
);
do $$ begin
  alter table cliente_perfil add constraint ck_cliente_perfil_confianca check (confianca in ('baixa', 'media', 'alta'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table cliente_perfil add constraint ck_cliente_perfil_segmento check (segmento is null or segmento in
    ('campeoes', 'leais', 'recentes', 'atencao', 'em_risco', 'inativos'));
exception when duplicate_object then null; end $$;
create index if not exists idx_cliente_perfil_segmento on cliente_perfil (tenant_id, segmento);
create index if not exists idx_cliente_perfil_etiquetas on cliente_perfil using gin (etiquetas);
alter table cliente_perfil enable row level security;

create table if not exists cliente_escolha (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  cliente_id     uuid not null references cliente(id) on delete cascade,
  escolha        text not null,
  valor          boolean not null,
  origem         text not null,
  texto          text,
  em             timestamptz not null default clock_timestamp()
);
do $$ begin
  alter table cliente_escolha add constraint ck_cliente_escolha_escolha check (escolha in
    ('recomendacoes', 'atendimento_personalizado', 'nao_analisar', 'maior_de_18'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table cliente_escolha add constraint ck_cliente_escolha_origem check (origem in
    ('cardapio_entrada', 'cardapio_perfil', 'cardapio_pedido', 'whatsapp', 'painel'));
exception when duplicate_object then null; end $$;
create index if not exists idx_cliente_escolha_atual on cliente_escolha (cliente_id, escolha, em desc);
alter table cliente_escolha enable row level security;

create table if not exists cliente_declarado (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  cliente_id     uuid not null references cliente(id) on delete cascade,
  chave          text not null,
  valor          jsonb not null,
  origem         text not null,
  informado_em   timestamptz not null default clock_timestamp(),
  atualizado_em  timestamptz not null default clock_timestamp()
);
do $$ begin
  alter table cliente_declarado add constraint ck_cliente_declarado_chave check (chave in
    ('time', 'respostas_curtas', 'prefere_audio', 'apelido', 'gostaria', 'alergia', 'nao_gosta'));
exception when duplicate_object then null; end $$;
create unique index if not exists uq_cliente_declarado on cliente_declarado (cliente_id, chave);
alter table cliente_declarado enable row level security;

create table if not exists perfil_cliente_execucao (
  tenant_id    uuid primary key references empresa(id) on delete cascade,
  rodou_em     timestamptz not null default clock_timestamp(),
  clientes     integer not null default 0,
  duracao_ms   integer not null default 0,
  erro         text
);
alter table perfil_cliente_execucao enable row level security;

-- Conferência (no mesmo Run).
select t as objeto, to_regclass(current_schema() || '.' || t) is not null as ok
  from unnest(array['cliente_perfil', 'cliente_escolha', 'cliente_declarado', 'perfil_cliente_execucao']) t;
