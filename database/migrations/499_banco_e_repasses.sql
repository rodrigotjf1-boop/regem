-- @cloud-only
-- 499 — BANCO E REPASSES, etapa R1 da versão 8 do Mister (protótipo `mockups/regem-mister-v8.html`, aba "Na loja"; decisões
-- V8-1 a V8-3 e V8-7 em `docs/plano-mister.md`). O extrato do banco entra por arquivo OFX, em Financeiro › Banco e repasses.
-- Só o presidente vê (a recusa é no servidor).
--
-- banco_empresa     — o sal da empresa: entra no resumo (HMAC) da descrição e da chave de cada lançamento.
-- banco_conta       — a conta de cada loja: SÓ o código do banco e os 4 últimos dígitos. O número inteiro não é gravado.
-- banco_importacao  — cada arquivo importado: período, contagens, saldo do arquivo e o período sem lançamento ("buraco").
-- banco_lancamento  — cada lançamento. A descrição gravada é SÓ a mascarada (V8-3): a crua não chega ao banco de dados.
--                     O índice único (conta, chave) é o que impede duplicar, inclusive com dois envios ao mesmo tempo.
-- banco_regra       — "Lembrar para os próximos": resumo da descrição → tipo. O texto não é guardado.
--
-- ⚠️ SÓ NUVEM: as cinco tabelas estão em SO_NUVEM no sync-daemon. RLS ligada e SEM política (como as do Mister).
-- Idempotente; nada que apague objeto (V9, LIC-171). Carimbos com clock_timestamp() (ERR-379).
set local lock_timeout = '5s';

create table if not exists banco_empresa (
  tenant_id  uuid primary key references empresa(id) on delete cascade,
  sal        text not null,
  criado_em  timestamptz not null default clock_timestamp()
);
alter table banco_empresa enable row level security;

create table if not exists banco_conta (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  unidade_id  uuid not null,
  banco       text not null default '',                 -- o código do banco no arquivo (BANKID), sem zeros à esquerda
  final       text not null,                            -- só os 4 últimos dígitos da conta
  criado_em   timestamptz not null default clock_timestamp()
);
alter table banco_conta enable row level security;
-- Uma conta por loja nesta etapa: é a conta contra a qual o "arquivo de outra conta" é conferido.
create unique index if not exists banco_conta_loja_uq on banco_conta (tenant_id, unidade_id);

create table if not exists banco_importacao (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  unidade_id      uuid not null,
  conta_id        uuid not null references banco_conta(id) on delete cascade,
  arquivo_hash    text not null,                        -- HMAC do arquivo com o sal da empresa ("esse arquivo já entrou")
  periodo_de      date,
  periodo_ate     date,
  linhas_arquivo  integer not null default 0,
  novos           integer not null default 0,
  repetidos       integer not null default 0,
  recusados       integer not null default 0,
  saldo_centavos  bigint,                               -- LEDGERBAL do arquivo
  saldo_em        date,
  buraco_de       date,                                 -- o período sem lançamento em dia que a loja vendeu
  buraco_ate      date,
  criado_por      uuid,
  criado_em       timestamptz not null default clock_timestamp()
);
alter table banco_importacao enable row level security;
create index if not exists banco_importacao_conta_idx on banco_importacao (conta_id, criado_em desc);
create index if not exists banco_importacao_empresa_idx on banco_importacao (tenant_id, criado_em desc);

create table if not exists banco_lancamento (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references empresa(id) on delete cascade,
  unidade_id       uuid not null,
  conta_id         uuid not null references banco_conta(id) on delete cascade,
  importacao_id    uuid not null references banco_importacao(id) on delete cascade,
  chave            text not null,                       -- HMAC de FITID + data + valor, ou de data + valor + descrição + ordem
  data             date not null,                       -- o dia escrito no arquivo, sem conversão de fuso
  valor_centavos   bigint not null,                     -- com sinal: entrada positiva, saída negativa
  descricao        text not null,                       -- SÓ a versão mascarada (V8-3)
  descricao_hash   text not null,                       -- HMAC da descrição normalizada e do sentido
  fonte            text not null default 'banco'
                   check (fonte in ('banco', 'ifood', 'ifood_pago', '99', 'maquininha')),
  situacao         text not null default 'so_no_banco'
                   check (situacao in ('casado', 'a_conferir', 'so_no_banco', 'esperado', 'nao_e_da_loja')),
  tipo             text,
  classificado_por uuid,
  classificado_em  timestamptz,
  criado_em        timestamptz not null default clock_timestamp()
);
alter table banco_lancamento enable row level security;
create unique index if not exists banco_lancamento_chave_uq on banco_lancamento (conta_id, chave);
create index if not exists banco_lancamento_lista_idx on banco_lancamento (tenant_id, data desc, id);
create index if not exists banco_lancamento_loja_idx on banco_lancamento (tenant_id, unidade_id, data desc);

create table if not exists banco_regra (
  tenant_id       uuid not null references empresa(id) on delete cascade,
  descricao_hash  text not null,
  tipo            text not null,
  criado_por      uuid,
  criado_em       timestamptz not null default clock_timestamp(),
  atualizado_em   timestamptz not null default clock_timestamp(),
  primary key (tenant_id, descricao_hash)
);
alter table banco_regra enable row level security;

comment on table banco_lancamento is 'Banco e repasses (mig 499): lançamentos do extrato OFX. A descrição é só a mascarada (V8-3)';
comment on table banco_conta is 'Banco e repasses (mig 499): só o código do banco e os 4 últimos dígitos da conta';

-- Conferência (no mesmo Run): as cinco tabelas, com RLS ligada e os índices únicos.
select c.relname as tabela,
       c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.schemaname = n.nspname and p.tablename = c.relname) as politicas,
       (select count(*) from pg_index i where i.indrelid = c.oid and i.indisunique) as indices_unicos
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema()
   and c.relkind = 'r'
   and c.relname in ('banco_empresa', 'banco_conta', 'banco_importacao', 'banco_lancamento', 'banco_regra')
 order by c.relname;
