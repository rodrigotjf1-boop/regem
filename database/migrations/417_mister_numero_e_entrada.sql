-- @cloud-only
-- 417 — MISTER: o número da distribuição e a entrada do WhatsApp (fase 2 do protótipo `mockups/regem-mister.html`,
-- aprovado em 13/11/2026; plano em `docs/plano-mister.md`).
--
-- O Mister fala por UM número de WhatsApp, da distribuição, com todas as empresas. Quem diz de qual empresa é a
-- conversa é o telefone de quem escreve — e ele só representa alguém depois de ligado por dentro do Regem, pela própria
-- pessoa, com um código de 10 minutos que vale uma vez.
--
-- mister_numero — a linha ÚNICA do número (`id = 1`, sem empresa: é da distribuição). `ligado` é a chave geral
--   "Mister nesta nuvem": nasce DESLIGADA, e desligada o Mister não responde nem avisa pelo WhatsApp em empresa nenhuma.
--   `situacao` = sem | conectado | caiu (conferido no serviço). O token de acesso à Meta NÃO mora aqui: é o da
--   distribuição, em variável de ambiente, como o dos números das lojas.
--
-- mister_vinculo — o telefone ligado a uma pessoa de uma empresa. O código é ÚNICO NA NUVEM INTEIRA (índice sem a
--   empresa): é ele que diz, na mensagem que chega, de qual empresa e de qual pessoa é o telefone. O mesmo telefone pode
--   estar em duas empresas (uma linha em cada); na mesma empresa, um número liga uma pessoa só.
--
-- mister_conversa — o estado da conversa de cada telefone: a empresa em uso (quando ele está em mais de uma), a
--   mensagem que esperava a escolha da empresa, os relógios das respostas fixas (para não repetir) e a contagem de
--   códigos errados (para não deixar adivinhar código). A rotina diária apaga a conversa parada há mais de 90 dias; o
--   vínculo do telefone com a pessoa não mora aqui.
--
-- mister_mensagem — cada mensagem recebida, UMA vez (a Meta reenvia): a chave é o id dela. Guarda o telefone, a empresa
--   (quando se soube) e o desfecho — NUNCA o texto. Uma rotina diária apaga o que passou de 30 dias.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as tabelas com empresa ficam em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como a 414 e a 415): fora do alcance da API
-- REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists mister_numero (
  id                 smallint primary key default 1,
  phone_id           text,                               -- o identificador do número na Meta (phone_number_id)
  waba_id            text,                               -- a conta do WhatsApp Business em que ele está
  numero             text,                               -- só dígitos, com o país
  nome_exibido       text,                               -- o nome que a Meta mostra ("Mister")
  forma              text,                               -- coexistencia (segue no celular) | api (só a API oficial)
  situacao           text not null default 'sem',        -- sem | conectado | caiu
  motivo             text,                               -- por que caiu (NULL quando conectado)
  ligado             boolean not null default false,     -- a chave geral: nasce desligada
  conectado_em       timestamptz,
  situacao_em        timestamptz,
  ultima_entrada_em  timestamptz,                        -- a última mensagem que chegou por ele
  alterado_por       text,                               -- quem mexeu por último no console (e-mail da distribuição)
  atualizado_em      timestamptz not null default now(),
  constraint ck_mister_numero_unica check (id = 1)
);
alter table mister_numero enable row level security;
insert into mister_numero (id) values (1) on conflict (id) do nothing;

create table if not exists mister_vinculo (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  colaborador_id     uuid not null references colaborador(id) on delete cascade,
  telefone           text,                               -- como a Meta manda (só dígitos); NULL = ainda não ligou
  codigo             text,                               -- seis dígitos; NULL depois de usado
  codigo_expira_em   timestamptz,
  ligado_em          timestamptz,
  pausado_em         timestamptz,                        -- respondeu PARAR AVISOS
  ultima_entrada_em  timestamptz,                        -- a última mensagem dele: abre a janela de 24 h da Meta
  criado_em          timestamptz not null default clock_timestamp(),
  atualizado_em      timestamptz not null default now(),
  constraint uq_mister_vinculo_pessoa unique (tenant_id, colaborador_id)
);
-- O código vale na nuvem inteira: duas empresas nunca têm o mesmo código vivo.
create unique index if not exists uq_mister_vinculo_codigo on mister_vinculo (codigo) where codigo is not null;
-- Um número liga uma pessoa só, por empresa.
create unique index if not exists uq_mister_vinculo_telefone on mister_vinculo (tenant_id, telefone) where telefone is not null;
-- A mensagem que chega procura pelo telefone, em todas as empresas.
create index if not exists ix_mister_vinculo_telefone on mister_vinculo (telefone) where telefone is not null;
alter table mister_vinculo enable row level security;

create table if not exists mister_conversa (
  telefone           text primary key,
  tenant_id          uuid references empresa(id) on delete set null,  -- a empresa em uso (telefone em mais de uma)
  escolhida_em       timestamptz,
  perguntada_em      timestamptz,                        -- quando o Mister perguntou "de qual empresa?"
  pendente           text,                               -- a mensagem que esperava a escolha (apagada ao usar ou vencer)
  pendente_em        timestamptz,
  fixa_em            timestamptz,                        -- a última resposta fixa a telefone não ligado
  provisoria_em      timestamptz,                        -- a última "ainda não respondo a perguntas"
  codigos_errados    integer not null default 0,
  codigos_desde      timestamptz,
  ultima_entrada_em  timestamptz,
  atualizado_em      timestamptz not null default now()
);
alter table mister_conversa enable row level security;

create table if not exists mister_mensagem (
  wamid              text primary key,                   -- o id da mensagem na Meta: a mesma nunca é tratada duas vezes
  telefone           text not null,
  tenant_id          uuid references empresa(id) on delete cascade,   -- NULL enquanto não se sabe de quem é
  desfecho           text,                               -- o que o Mister fez (ligou, fixa, perguntou_empresa, …); nunca o texto
  recebida_em        timestamptz not null default clock_timestamp()
);
create index if not exists ix_mister_mensagem_recebida on mister_mensagem (recebida_em);
alter table mister_mensagem enable row level security;

comment on table mister_numero is 'Mister (mig 417): o número de WhatsApp da distribuição e a chave geral — linha única, só nuvem';
comment on table mister_vinculo is 'Mister (mig 417): o telefone ligado a uma pessoa de uma empresa, por código único na nuvem — só nuvem';
comment on table mister_conversa is 'Mister (mig 417): o estado da conversa de cada telefone (empresa em uso, relógios das respostas fixas) — só nuvem, 90 dias parada';
comment on table mister_mensagem is 'Mister (mig 417): cada mensagem recebida uma vez, sem o texto — só nuvem, 30 dias';

-- Conferência (no mesmo Run): as quatro tabelas (com RLS), as colunas de cada uma, os índices e a linha única do número.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname in ('mister_numero', 'mister_vinculo', 'mister_conversa', 'mister_mensagem')
union all
select 'colunas', table_name, count(*)::text
  from information_schema.columns
 where table_schema = current_schema() and table_name in ('mister_numero', 'mister_vinculo', 'mister_conversa', 'mister_mensagem')
 group by table_name
union all
select 'indice', indexname, tablename
  from pg_indexes
 where schemaname = current_schema() and indexname in ('uq_mister_vinculo_codigo', 'uq_mister_vinculo_telefone', 'ix_mister_vinculo_telefone', 'ix_mister_mensagem_recebida')
union all
select 'numero', 'linhas', count(*)::text from mister_numero
 order by 1, 2;
