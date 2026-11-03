-- @cloud-only
-- 357 · ANIVERSÁRIO DO CLIENTE, A PROTEÇÃO CONTRA TROCA DE DATA E O CUPOM PESSOAL (Onda 3 · PR 3; protótipo
-- `mockups/regem-relacionamento.html` aprovado pelo dono em 03/11/2026, com a proteção pedida por ele no mesmo dia). Só
-- NUVEM: o cadastro de clientes da loja (Delivery › Clientes), o cardápio, o robô e o WhatsApp moram lá (SO_NUVEM no
-- sync-daemon).
--
-- O que entra:
--   cliente_aniversario — dia e mês (sem o ano), QUANDO e POR QUEM foram informados (o cliente no Perfil ou na pergunta
--     da confirmação do pedido; a loja em Delivery › Clientes), quantas vezes o cliente corrigiu (uma; depois só gerente
--     e presidente), o "Agora não" da pergunta e o último presente. À PARTE de `cliente`: o `cliente` sincroniza com a
--     loja nos dois sentidos, por linha inteira — uma data gravada na nuvem podia ser apagada pela cópia da loja.
--   relacionamento_config.aniversario_* — a automática "Aniversário" (nasce DESLIGADA): quando (no dia, 3 ou 7 dias
--     antes), o presente (cupom ou só os parabéns), o desconto, o pedido mínimo e a validade do cupom.
--   cupom_regra — o que o cupom da loja não guarda: "só aniversariantes" (a condição nova do cadastro de cupons) e o
--     cupom PESSOAL (de um cliente só — o presente das automáticas). À PARTE de `cupom`: o `cupom` desce para a loja
--     (coluna nova nele pediria a migration da loja — ERR-029, como a `integracao_cupom` da 298).
--   relacionamento_envio.cupom_id — o cupom que a mensagem levou (o resultado conta os usados).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. O `lock_timeout` desiste em vez de
-- enfileirar escrita atrás de alguma trava.
set local lock_timeout = '5s';

create table if not exists cliente_aniversario (
  cliente_id         uuid primary key references cliente(id) on delete cascade,
  tenant_id          uuid not null references empresa(id) on delete cascade,
  dia                smallint,
  mes                smallint,
  informado_em       timestamptz,
  origem             text,
  informado_por      uuid,
  correcoes_cliente  smallint not null default 0,
  nao_perguntar      boolean not null default false,
  ultimo_presente_em timestamptz,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
do $$ begin
  alter table cliente_aniversario add constraint ck_cliente_aniv_data check (
    (dia is null and mes is null and informado_em is null)
    or (mes between 1 and 12 and informado_em is not null and dia between 1 and
        (case mes when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end)));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table cliente_aniversario add constraint ck_cliente_aniv_origem check (origem is null or origem in ('perfil', 'confirmacao', 'loja'));
exception when duplicate_object then null; end $$;
create index if not exists idx_cliente_aniv_data on cliente_aniversario (tenant_id, mes, dia);

alter table relacionamento_config add column if not exists aniversario_ativo boolean not null default false;
alter table relacionamento_config add column if not exists aniversario_quando text not null default 'no_dia';
alter table relacionamento_config add column if not exists aniversario_presente text not null default 'cupom';
alter table relacionamento_config add column if not exists aniversario_desconto text not null default 'v10';
alter table relacionamento_config add column if not exists aniversario_minimo numeric(10, 2) not null default 40;
alter table relacionamento_config add column if not exists aniversario_validade_dias integer not null default 7;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_aniv_quando check (aniversario_quando in ('no_dia', '3_antes', '7_antes'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_aniv_presente check (aniversario_presente in ('cupom', 'nada'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_aniv_desconto check (aniversario_desconto in ('v5', 'v10', 'v15', 'p10', 'p15', 'frete'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_aniv_minimo check (aniversario_minimo in (0, 30, 40, 60));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table relacionamento_config add constraint ck_rel_config_aniv_validade check (aniversario_validade_dias in (3, 7, 15));
exception when duplicate_object then null; end $$;

create table if not exists cupom_regra (
  cupom_id               uuid primary key references cupom(id) on delete cascade,
  tenant_id              uuid not null references empresa(id) on delete cascade,
  so_aniversariantes     boolean not null default false,
  cliente_id             uuid,
  chave_telefone         text,
  origem                 text,
  relacionamento_envio_id uuid,
  criado_em              timestamptz not null default now()
);
do $$ begin
  alter table cupom_regra add constraint ck_cupom_regra_pessoal check ((cliente_id is null) = (chave_telefone is null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table cupom_regra add constraint ck_cupom_regra_origem check (origem is null or origem in ('aniversario', 'volta'));
exception when duplicate_object then null; end $$;
create index if not exists idx_cupom_regra_cliente on cupom_regra (tenant_id, cliente_id);

alter table relacionamento_envio add column if not exists cupom_id uuid;

-- Data de aniversário e quem ganhou cupom: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política.
alter table cliente_aniversario enable row level security;
alter table cupom_regra enable row level security;

-- Conferência no MESMO Run: as cinco linhas têm de vir com `ok = true`.
select 'tabela cliente_aniversario' as objeto,
       to_regclass(current_schema() || '.cliente_aniversario') is not null as ok
union all
select 'tabela cupom_regra',
       to_regclass(current_schema() || '.cupom_regra') is not null
union all
select 'ajustes do aniversário (6 colunas)',
       (select count(*) = 6 from information_schema.columns
         where table_schema = current_schema() and table_name = 'relacionamento_config' and column_name like 'aniversario_%')
union all
select 'regras (data, origem, 5 do aniversário, pessoal, origem do cupom)',
       (select count(*) = 9 from pg_constraint
         where connamespace = to_regnamespace(current_schema()) and conname in ('ck_cliente_aniv_data', 'ck_cliente_aniv_origem', 'ck_rel_config_aniv_quando', 'ck_rel_config_aniv_presente',
                           'ck_rel_config_aniv_desconto', 'ck_rel_config_aniv_minimo', 'ck_rel_config_aniv_validade',
                           'ck_cupom_regra_pessoal', 'ck_cupom_regra_origem'))
union all
select 'RLS ligada nas duas e o cupom no envio',
       coalesce((select bool_and(c.relrowsecurity) from pg_class c
                  where c.oid in (to_regclass(current_schema() || '.cliente_aniversario'),
                                  to_regclass(current_schema() || '.cupom_regra'))), false)
       and exists (select 1 from information_schema.columns where table_schema = current_schema()
                     and table_name = 'relacionamento_envio' and column_name = 'cupom_id');
