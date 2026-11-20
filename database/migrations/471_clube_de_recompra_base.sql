-- @cloud-only
-- 471 · CLUBE DE RECOMPRA — A BASE (fase A0 do `docs/plano-clube-e-banner.md`; protótipo `mockups/regem-clube-banner.html`,
-- parte "Marketing › Clube", aprovado pelo dono em 20/11/2026 com as dez recomendadas). Só NUVEM: o clube roda na nuvem
-- (D6 — a rotina olha os pedidos entregues que sobem da loja), o cardápio e o robô moram lá; a loja não tem estas tabelas.
--
-- O que entra:
--   clube_config — uma linha por empresa: cada ferramenta liga e desliga sozinha (o prêmio surpresa, o álbum de selos e a
--     meta do mês — TODAS NASCEM DESLIGADAS; só o presidente liga), a forma de revelar (raspadinha ou roleta), o álbum
--     (selos para completar, validade dos selos, os prêmios de quem completa), a meta (os níveis e a validade do prêmio) e
--     o pedido mínimo que conta para as três. Os gatilhos do prêmio surpresa (`surpresa_gatilhos`) entram vazios: cada
--     fase grava a sua chave (V82).
--   clube_premio — o catálogo de prêmios da loja. O prêmio vira CUPOM PESSOAL de desconto quando o cliente ganha (D3 —
--     nunca item a R$ 0,00): desconto em %, com teto; desconto em R$; frete grátis; ou um produto grátis (100% de
--     desconto naquele produto). Pedido mínimo e validade de cada um. Excluir só esconde (`excluido_em`): quem já ganhou
--     continua usando até a validade.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabelas novas e vazias; o `lock_timeout`
-- desiste em vez de enfileirar escrita atrás de alguma trava.
set local lock_timeout = '5s';

create table if not exists clube_config (
  tenant_id             uuid primary key references empresa(id) on delete cascade,
  surpresa_ativo        boolean not null default false,
  surpresa_forma        text not null default 'raspadinha',
  surpresa_gatilhos     jsonb not null default '{}'::jsonb,
  album_ativo           boolean not null default false,
  album_selos           smallint not null default 4,
  album_validade_meses  smallint not null default 12,
  album_premios         jsonb not null default '[]'::jsonb,
  meta_ativo            boolean not null default false,
  meta_niveis           jsonb not null default '[{"pedidos": 3, "premios": []}, {"pedidos": 6, "premios": []}]'::jsonb,
  meta_validade_dias    smallint not null default 15,
  minimo                numeric(10, 2) not null default 30,
  atualizado_por        uuid,
  atualizado_em         timestamptz not null default now(),
  criado_em             timestamptz not null default now()
);
do $$ begin
  alter table clube_config add constraint ck_clube_config_forma check (surpresa_forma in ('raspadinha', 'roleta'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clube_config add constraint ck_clube_config_album check (album_selos between 3 and 12 and album_validade_meses in (6, 12));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clube_config add constraint ck_clube_config_meta check (meta_validade_dias in (15, 30));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clube_config add constraint ck_clube_config_minimo check (minimo between 0 and 1000);
exception when duplicate_object then null; end $$;

create table if not exists clube_premio (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  nome            text not null,
  tipo            text not null,
  valor           numeric(10, 2) not null default 0,
  teto            numeric(10, 2),
  produto_id      uuid,
  minimo          numeric(10, 2) not null default 0,
  validade_dias   smallint not null default 7,
  excluido_em     timestamptz,
  atualizado_por  uuid,
  atualizado_em   timestamptz not null default now(),
  criado_em       timestamptz not null default now()
);
do $$ begin
  alter table clube_premio add constraint ck_clube_premio_tipo check (
    (tipo = 'percentual' and valor between 1 and 100 and produto_id is null)
    or (tipo = 'valor' and valor > 0 and teto is null and produto_id is null)
    or (tipo = 'fretegratis' and valor = 0 and teto is null and produto_id is null)
    or (tipo = 'produto' and valor = 0 and teto is null and produto_id is not null));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clube_premio add constraint ck_clube_premio_nome check (char_length(btrim(nome)) between 1 and 60);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table clube_premio add constraint ck_clube_premio_numeros check (
    minimo between 0 and 1000 and (teto is null or teto > 0) and validade_dias in (3, 7, 15, 30));
exception when duplicate_object then null; end $$;
create index if not exists idx_clube_premio_empresa on clube_premio (tenant_id) where excluido_em is null;

-- Quem ganha o quê é dado de cliente (as próximas fases): fora do alcance da API REST anônima do Supabase. RLS ligada e
-- SEM política, como a 342, a 357 e a 442 (o app usa um papel que atravessa a RLS).
alter table clube_config enable row level security;
alter table clube_premio enable row level security;

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`.
select 'tabela clube_config' as objeto,
       to_regclass(current_schema() || '.clube_config') is not null as ok
union all
select 'tabela clube_premio',
       to_regclass(current_schema() || '.clube_premio') is not null
union all
select 'regras (forma, álbum, meta, mínimo, tipo do prêmio, nome, números)',
       (select count(*) = 7 from pg_constraint
         where connamespace = to_regnamespace(current_schema())
           and conname in ('ck_clube_config_forma', 'ck_clube_config_album', 'ck_clube_config_meta', 'ck_clube_config_minimo',
                           'ck_clube_premio_tipo', 'ck_clube_premio_nome', 'ck_clube_premio_numeros'))
union all
select 'RLS ligada nas duas',
       coalesce((select bool_and(c.relrowsecurity) from pg_class c
                  where c.oid in (to_regclass(current_schema() || '.clube_config'), to_regclass(current_schema() || '.clube_premio'))), false);
