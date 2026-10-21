-- @cloud-only
-- 336 · A AUTORIZAÇÃO POR CLIQUE do Regem (Hub DMS, F3, parte C; Padrão DMS §3; decisões C-1 a C-5 do dono, 21/10/2026).
-- Só NUVEM, como a 295, a 303 e a 329: o servidor da loja não tem a API de integração. Nasce sem uso: a página nova só
-- abre com `AUTORIZACAO_POR_CLIQUE` ligada.
--
-- O que entra:
--   integracao_pedido — o pedido que o servidor do aplicativo empurra (RFC 9126), com o token do DMS ID: o endereço de
--     volta, as permissões pedidas, o state, o desafio do PKCE e a conta que pede. Só o resumo do número fica gravado;
--     vale 10 minutos e uma vez (autorizar ou recusar gasta).
--   integracao_autorizacao (303) ganha a prova do clique: o pedido, a conta que pede, se era outra empresa, as opcionais
--     desligadas e o texto mostrado, com a versão. Linha com texto é prova: a limpeza dos códigos vencidos não a apaga.
--   integracao_token_loja (295) ganha a autorização de onde o acesso veio e o índice único de UM acesso ativo do clique
--     por loja e aplicativo (V24: duas trocas da mesma loja ao mesmo tempo terminam com um acesso só).
--   integracao_autorizacao_trava — as senhas erradas na autorização (5 em 15 minutos travam por 15 minutos), separadas da
--     entrada no Regem. Fica fora do `colaborador`, que sincroniza com o servidor da loja.
--
-- Sem instrução destrutiva (a migration vai à nuvem pelo MCP: V9, ERR-225). Idempotente: rodar de novo não muda nada.

set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_autorizacao') is null
     or to_regclass(current_schema() || '.integracao_ligacao') is null then
    raise exception 'A 336 depende da 303 (integracao_autorizacao) e da 329 (integracao_ligacao): aplique-as antes.';
  end if;
end $$;

-- ───────────────────────────── o pedido empurrado ─────────────────────────────

create table if not exists integracao_pedido (
  id             uuid primary key default gen_random_uuid(),
  cliente        text not null,                 -- 'liame': o aplicativo no catálogo do Regem
  aplicativo     text not null,                 -- o client_id do DMS ID que empurrou o pedido
  numero_hash    text not null unique,          -- sha256 (hex) do número; o número em si nunca é gravado
  redirect_uri   text not null,
  necessarias    text[] not null default '{}',
  opcionais      text[] not null default '{}',
  state          text not null,
  desafio        text not null,                 -- code_challenge do PKCE (S256)
  conta_que_pede jsonb not null,                -- {nome, cnpj, email, marca}
  criado_em      timestamptz not null default now(),
  vence_em       timestamptz not null,          -- criado_em + 10 minutos
  usado_em       timestamptz,                   -- autorizar ou recusar gasta o pedido
  constraint ck_integracao_pedido_cliente check (cliente ~ '^[a-z][a-z0-9_-]{1,39}$'),
  constraint ck_integracao_pedido_aplicativo check (aplicativo ~ '^[A-Za-z0-9_-]{4,64}$'),
  constraint ck_integracao_pedido_hash check (numero_hash ~ '^[0-9a-f]{64}$'),
  constraint ck_integracao_pedido_state check (length(state) between 16 and 200),
  constraint ck_integracao_pedido_desafio check (desafio ~ '^[A-Za-z0-9_-]{43}$'),
  constraint ck_integracao_pedido_permissoes check (cardinality(necessarias) + cardinality(opcionais) > 0),
  constraint ck_integracao_pedido_conta check (jsonb_typeof(conta_que_pede) = 'object'),
  constraint ck_integracao_pedido_validade check (vence_em > criado_em)
);

create index if not exists idx_integracao_pedido_vence on integracao_pedido (vence_em);

alter table integracao_pedido enable row level security;

-- ───────────────────────────── a prova do clique (na 303) ─────────────────────────────

alter table integracao_autorizacao add column if not exists pedido_id uuid references integracao_pedido(id) on delete set null;
alter table integracao_autorizacao add column if not exists conta_que_pede jsonb;
alter table integracao_autorizacao add column if not exists outra_empresa boolean not null default false;
alter table integracao_autorizacao add column if not exists opcionais_desligados text[] not null default '{}';
alter table integracao_autorizacao add column if not exists texto_versao integer;
alter table integracao_autorizacao add column if not exists texto jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'ck_integracao_autorizacao_texto'
                    and conrelid = to_regclass(current_schema() || '.integracao_autorizacao')) then
    alter table integracao_autorizacao add constraint ck_integracao_autorizacao_texto
      check (texto is null or (jsonb_typeof(texto) = 'object' and texto_versao >= 1));
  end if;
end $$;

-- ───────────────────────────── de onde o acesso veio (na 295) ─────────────────────────────

alter table integracao_token_loja add column if not exists autorizacao_id uuid references integracao_autorizacao(id) on delete set null;

create index if not exists idx_integracao_token_loja_autorizacao
  on integracao_token_loja (autorizacao_id) where autorizacao_id is not null;

-- UM acesso ativo do clique por loja e aplicativo. Os acessos de antes (console da distribuição e página de 01/10) não
-- entram: a troca do clique os revoga na mesma transação em que cria o novo.
create unique index if not exists uq_integracao_token_loja_clique_ativo
  on integracao_token_loja (tenant_id, unidade_id, cliente)
  where revogado_em is null and autorizacao_id is not null;

-- ───────────────────────────── a trava da senha na autorização ─────────────────────────────

create table if not exists integracao_autorizacao_trava (
  colaborador_id uuid primary key,              -- quem tenta autorizar (o presidente logado)
  tenant_id      uuid not null references empresa(id) on delete cascade,
  erros          integer not null default 0,
  erro_em        timestamptz,                   -- a última senha errada: a janela de 15 minutos conta daqui
  travada_ate    timestamptz,
  constraint ck_integracao_autorizacao_trava_erros check (erros >= 0)
);

alter table integracao_autorizacao_trava enable row level security;

-- ───────────────────────────── conferência ─────────────────────────────

select 'tabela integracao_pedido' as objeto,
       to_regclass(current_schema() || '.integracao_pedido') is not null as ok
union all
select 'índice único do numero_hash',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'integracao_pedido'
                  and indexdef ilike '%unique%(numero_hash)%')
union all
select 'a prova do clique na integracao_autorizacao (6 colunas)',
       (select count(*) = 6 from information_schema.columns
         where table_schema = current_schema() and table_name = 'integracao_autorizacao'
           and column_name in ('pedido_id', 'conta_que_pede', 'outra_empresa', 'opcionais_desligados', 'texto_versao', 'texto'))
union all
select 'a trava do texto da prova',
       exists (select 1 from pg_constraint
                where conname = 'ck_integracao_autorizacao_texto'
                  and conrelid = to_regclass(current_schema() || '.integracao_autorizacao'))
union all
select 'integracao_token_loja.autorizacao_id',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'integracao_token_loja'
                  and column_name = 'autorizacao_id')
union all
select 'índice único do acesso ativo do clique',
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'integracao_token_loja'
                  and indexname = 'uq_integracao_token_loja_clique_ativo' and indexdef ilike '%unique%')
union all
select 'tabela integracao_autorizacao_trava',
       to_regclass(current_schema() || '.integracao_autorizacao_trava') is not null
union all
select 'RLS ligada nas duas tabelas novas',
       coalesce((select bool_and(c.relrowsecurity) and count(*) = 2 from pg_class c
                  where c.oid in (to_regclass(current_schema() || '.integracao_pedido'),
                                  to_regclass(current_schema() || '.integracao_autorizacao_trava'))), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
