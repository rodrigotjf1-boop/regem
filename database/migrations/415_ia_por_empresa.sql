-- @cloud-only
-- 415 — IA POR EMPRESA: a chave de IA do lojista e o medidor de uso (base da F2 do plano do Mister, `docs/plano-mister.md`;
-- decisão do dono de 12/11/2026: cada lojista configura a própria chave de IA e paga os próprios créditos, e ao fim da
-- implementação, com o gasto MEDIDO na loja piloto, decide-se se continua assim ou se a distribuição passa a bancar).
--
-- ia_credencial — UMA chave de IA por empresa. A chave fica CIFRADA (`common/cifra-segredo.ts`, AES-256-GCM com a
--   `SEGREDOS_CHAVE` desta nuvem) em tabela PRÓPRIA, fora de qualquer tabela de configuração (ERR-080): segredo não viaja.
--   `final` = os 4 últimos caracteres, só para o dono reconhecer qual chave está salva (o console do provedor mostra o
--   mesmo). `situacao` = o que a última chamada com esta chave disse: ok | chave_recusada | sem_credito | teto_atingido
--   (conferido no serviço, sem `check`, para a lista poder crescer sem trocar restrição). Só o presidente grava ou apaga;
--   a API nunca devolve a coluna cifrada.
--
-- ia_uso_dia — o MEDIDOR: uma linha por empresa, dia, recurso (copiloto, prova da chave, e depois o Mister), provedor,
--   modelo e origem da chave (a do lojista ou a da distribuição). Cada chamada SOMA na linha do dia (uma gravação, sem
--   laço — a linha não cresce com o volume). É o que vai dizer, ao fim dos testes, quanto a IA custa por loja. O `dia` é
--   informado pelo serviço no fuso da operação (V46), nunca pelo relógio do banco.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as duas tabelas ficam em SO_NUVEM no sync-daemon; a chave do
-- lojista NUNCA desce para a loja). Idempotente; nada que apague objeto (LIC-171).
-- RLS ligada e SEM política (como a 342/356/372/414): fora do alcance da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists ia_credencial (
  tenant_id      uuid primary key references empresa(id) on delete cascade,
  provedor       text not null,                       -- anthropic (a lista aceita mora no serviço)
  chave_cifrada  text not null,                       -- "v1:…" (cifra-segredo); nunca sai pela API
  final          text not null default '',            -- os 4 últimos caracteres da chave, para reconhecer
  situacao       text not null default 'ok',          -- ok | chave_recusada | sem_credito | teto_atingido
  conferida_em   timestamptz,                         -- a última vez que a situação mudou ou foi provada
  ultimo_motivo  text,                                -- o motivo da última recusa (NULL quando ok)
  salva_por      uuid,                                -- o colaborador que cadastrou; sem FK: ele pode sair e a chave fica
  salva_em       timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
alter table ia_credencial enable row level security;

create table if not exists ia_uso_dia (
  tenant_id             uuid not null references empresa(id) on delete cascade,
  dia                   date not null,                -- o dia no fuso da operação, informado pelo serviço
  recurso               text not null,                -- copiloto | prova | …
  provedor              text not null,
  modelo                text not null,
  origem                text not null,                -- de quem é a chave que pagou: lojista | distribuicao
  chamadas              integer not null default 0,   -- as que foram ao provedor (com as que falharam)
  falhas                integer not null default 0,
  tokens_entrada        bigint not null default 0,    -- entrada sem cache
  tokens_cache_escrita  bigint not null default 0,
  tokens_cache_leitura  bigint not null default 0,
  tokens_saida          bigint not null default 0,
  atualizado_em         timestamptz not null default now(),
  constraint pk_ia_uso_dia primary key (tenant_id, dia, recurso, provedor, modelo, origem),
  constraint ck_ia_uso_dia_origem check (origem in ('lojista', 'distribuicao'))
);
alter table ia_uso_dia enable row level security;

comment on table ia_credencial is 'IA por empresa (mig 415): a chave de IA do lojista, cifrada — só nuvem, nunca desce para a loja nem sai pela API';
comment on table ia_uso_dia is 'IA por empresa (mig 415): o medidor de uso por dia, recurso, modelo e origem da chave — só nuvem';

-- Conferência (no mesmo Run): as duas tabelas (com RLS) e as colunas de cada uma.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname in ('ia_credencial', 'ia_uso_dia')
union all
select 'colunas', table_name, count(*)::text
  from information_schema.columns
 where table_schema = current_schema() and table_name in ('ia_credencial', 'ia_uso_dia')
 group by table_name
 order by 1, 2;
