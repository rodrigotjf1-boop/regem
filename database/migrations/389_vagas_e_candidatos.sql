-- @cloud-only
-- 389 · VAGAS E CANDIDATOS (F1 — pedido do dono, 10/11/2026; plano aprovado no mesmo dia). A loja publica uma página de vagas (`/v/<codigo>`, aberta pelo QR impresso, pelo link de
-- post e pelo robô) e o candidato preenche a ficha no celular; as fichas caem em Pessoas › Candidatos. Só NUVEM: a página
-- é pública na internet e a ficha chega lá; a loja não tem estas tabelas (o servidor da loja pede à nuvem).
--
-- O que entra:
--   vaga_pagina — os ajustes da página, UM por loja (único por empresa e loja). `codigo` = o endereço público, único no
--     sistema inteiro (não é segredo: só mostra o que a loja escolheu). `funcoes` = [{codigo, nome, salario, lideranca,
--     aberta}]; `beneficios` = [texto]; `horarios` = {"12x36":{ativa,inicio,fim}, "5x2":{…}, "horista":{ativa,inicio,fim,
--     dias}}; `perguntas` = as perguntas extras ligadas ({"cnh":true,…}); `cor_principal`/`cor_destaque` = as cores da
--     página (tiradas da logo da loja; vazias = as do cardápio online). Nasce DESLIGADA (`ligada = false`).
--   vaga_qr — os pontos de QR da loja (balcão, salão…): `codigo` vai no link (`?o=<codigo>`) e diz de onde veio a ficha.
--   candidato — a ficha. Única por empresa, loja e telefone (V24): o reenvio com o mesmo WhatsApp ATUALIZA a ficha e o
--     histórico guarda o que mudou. `telefone` = `telefoneCadastro` (sem o 55, ERR-135). `protocolo` = o número que o
--     candidato vê (único na empresa). `valor_ida`/`valor_volta` = o que ELE informou (o sistema não calcula).
--     `conducoes` = o que ele confirmou (a estimativa do Google não fica gravada — termos do Google). `consentimento_*` =
--     a guarda dos dados (obrigatório); `comunicacao_*` = o termo de mensagens e e-mails (opcional; nulo = não autorizou).
--     `expurgo_em` = quando a ficha não contratada se apaga sozinha (guarda da loja: 6, 12 ou 24 meses).
--   candidato_experiencia — as experiências de trabalho e de liderança (vínculo carteira ou informal).
--   candidato_curso — os cursos (fazendo, concluído ou não terminou).
--   candidato_evento — o histórico da ficha (só acrescenta): recebida, reenviada, situação, anotação, entrevista.
--   As filhas caem junto com a ficha (`on delete cascade`): "Apagar dados" (LGPD) e o expurgo não deixam resto.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Só tabelas novas (com as FKs delas para
-- `empresa` e `unidade`); nenhuma FK nova em tabela que já existe (ERR-377). Datas de ordem por clock_timestamp() (ERR-379).
-- O `lock_timeout` desiste em vez de enfileirar escrita atrás das tabelas.
set local lock_timeout = '5s';

create table if not exists vaga_pagina (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid not null references unidade(id) on delete cascade,
  codigo         text not null,
  ligada         boolean not null default false,
  titulo         text,
  frase          text,
  funcoes        jsonb not null default '[]',
  beneficios     jsonb not null default '[]',
  vaga_fixa      boolean not null default true,
  horista        boolean not null default true,
  horarios       jsonb not null default '{}',
  idade_minima   smallint not null default 18,
  guarda_meses   smallint not null default 12,
  perguntas      jsonb not null default '{}',
  cor_principal  text,
  cor_destaque   text,
  criado_em      timestamptz not null default clock_timestamp(),
  atualizado_em  timestamptz not null default clock_timestamp(),
  constraint uq_vaga_pagina_loja unique (tenant_id, unidade_id),
  constraint uq_vaga_pagina_codigo unique (codigo),
  constraint ck_vaga_pagina_codigo check (codigo ~ '^[a-z0-9][a-z0-9-]{2,39}$'),
  constraint ck_vaga_pagina_idade check (idade_minima between 14 and 24),
  constraint ck_vaga_pagina_guarda check (guarda_meses in (6, 12, 24))
);
alter table vaga_pagina enable row level security;

create table if not exists vaga_qr (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  unidade_id  uuid not null references unidade(id) on delete cascade,
  codigo      text not null,
  nome        text not null,
  criado_em   timestamptz not null default clock_timestamp(),
  constraint uq_vaga_qr unique (tenant_id, unidade_id, codigo),
  constraint ck_vaga_qr_codigo check (codigo ~ '^[a-z0-9][a-z0-9-]{1,29}$')
);
alter table vaga_qr enable row level security;

create table if not exists candidato (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references empresa(id) on delete cascade,
  unidade_id                uuid not null references unidade(id) on delete cascade,
  protocolo                 text not null,
  situacao                  text not null default 'novo',
  nome                      text not null,
  nascimento                date not null,
  sexo                      text,
  telefone                  text not null,
  email                     text,
  cep                       text,
  rua                       text,
  numero                    text,
  complemento               text,
  bairro                    text,
  cidade                    text,
  meios_transporte          text[] not null default '{}',
  conducoes                 smallint,
  uber_motivo               text,
  uber_obs                  text,
  valor_ida                 numeric(8,2),
  valor_volta               numeric(8,2),
  funcoes                   text[] not null default '{}',
  setores                   text[] not null default '{}',
  tipo_vaga                 text not null,
  escala                    text,
  dias                      text[] not null default '{}',
  obs_horarios              text,
  experiencia               text not null,
  liderou                   boolean,
  estuda                    boolean not null,
  grau_estudo               text not null,
  escola                    text not null,
  turno_estudo              text,
  cursos_situacao           text not null,
  trabalhando               boolean not null,
  comeca                    text not null,
  respostas                 jsonb not null default '{}',
  origem                    text,
  entrevista_em             timestamptz,
  colaborador_id            uuid,
  consentimento_em          timestamptz not null,
  consentimento_versao      text not null,
  comunicacao_aceita_em     timestamptz,
  comunicacao_versao        text,
  comunicacao_cancelada_em  timestamptz,
  expurgo_em                date not null,
  recebido_em               timestamptz not null default clock_timestamp(),
  criado_em                 timestamptz not null default clock_timestamp(),
  atualizado_em             timestamptz not null default clock_timestamp(),
  constraint uq_candidato_telefone unique (tenant_id, unidade_id, telefone),
  constraint uq_candidato_protocolo unique (tenant_id, protocolo),
  constraint ck_candidato_situacao check (situacao in ('novo', 'analise', 'entrevista', 'aprovado', 'contratado', 'banco', 'reprovado')),
  constraint ck_candidato_tipo check (tipo_vaga in ('fixa', 'horista', 'tanto')),
  constraint ck_candidato_escala check (escala is null or escala in ('12x36', '5x2', 'tanto')),
  constraint ck_candidato_experiencia check (experiencia in ('sim', 'outra', 'primeiro')),
  constraint ck_candidato_cursos check (cursos_situacao in ('fazendo', 'fez', 'nunca')),
  constraint ck_candidato_sexo check (sexo is null or sexo in ('feminino', 'masculino', 'outro', 'nao_informar')),
  constraint ck_candidato_valores check (coalesce(valor_ida, 0) >= 0 and coalesce(valor_volta, 0) >= 0)
);
-- A lista da tela (a loja em uso, da mais nova à mais velha) e o expurgo diário (o contratado não se apaga).
create index if not exists idx_candidato_lista on candidato (tenant_id, unidade_id, recebido_em desc, id desc);
create index if not exists idx_candidato_expurgo on candidato (expurgo_em) where situacao <> 'contratado';
alter table candidato enable row level security;

create table if not exists candidato_experiencia (
  id            uuid primary key default gen_random_uuid(),
  candidato_id  uuid not null references candidato(id) on delete cascade,
  tenant_id     uuid not null references empresa(id) on delete cascade,
  tipo          text not null,
  ordem         smallint not null,
  empresa       text not null,
  funcao        text,
  cargo         text,
  equipe        text,
  tempo         text not null,
  vinculo       text not null,
  atual         boolean not null default false,
  descricao     text,
  constraint ck_candidato_experiencia_tipo check (tipo in ('trabalho', 'lideranca')),
  constraint ck_candidato_experiencia_vinculo check (vinculo in ('carteira', 'informal'))
);
create index if not exists idx_candidato_experiencia on candidato_experiencia (candidato_id, tipo, ordem);
alter table candidato_experiencia enable row level security;

create table if not exists candidato_curso (
  id            uuid primary key default gen_random_uuid(),
  candidato_id  uuid not null references candidato(id) on delete cascade,
  tenant_id     uuid not null references empresa(id) on delete cascade,
  ordem         smallint not null,
  nome          text not null,
  onde          text not null,
  situacao      text not null,
  constraint ck_candidato_curso_situacao check (situacao in ('fazendo', 'concluido', 'parou'))
);
create index if not exists idx_candidato_curso on candidato_curso (candidato_id, ordem);
alter table candidato_curso enable row level security;

create table if not exists candidato_evento (
  id            uuid primary key default gen_random_uuid(),
  candidato_id  uuid not null references candidato(id) on delete cascade,
  tenant_id     uuid not null references empresa(id) on delete cascade,
  tipo          text not null,
  de            text,
  para          text,
  texto         text,
  autor_id      uuid,
  autor_nome    text,
  criado_em     timestamptz not null default clock_timestamp(),
  constraint ck_candidato_evento_tipo check (tipo in ('recebida', 'reenviada', 'situacao', 'anotacao', 'entrevista', 'comunicacao'))
);
create index if not exists idx_candidato_evento on candidato_evento (candidato_id, criado_em, id);
alter table candidato_evento enable row level security;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'as 6 tabelas com RLS' as objeto,
       (select count(*) = 6 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relrowsecurity
           and c.relname in ('vaga_pagina', 'vaga_qr', 'candidato', 'candidato_experiencia', 'candidato_curso', 'candidato_evento')) as ok
union all
select 'únicos: página por loja, código da página, QR por loja, ficha por telefone, protocolo',
       (select count(*) = 5 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema()
           and k.conname in ('uq_vaga_pagina_loja', 'uq_vaga_pagina_codigo', 'uq_vaga_qr', 'uq_candidato_telefone', 'uq_candidato_protocolo'))
union all
select 'as filhas caem com a ficha (on delete cascade)',
       (select count(*) = 3 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.contype = 'f' and k.confdeltype = 'c'
           and k.confrelid = to_regclass(current_schema() || '.candidato')
           and c.relname in ('candidato_experiencia', 'candidato_curso', 'candidato_evento'))
union all
select 'candidato: recebido_em e criado_em por clock_timestamp()',
       (select count(*) = 2 from information_schema.columns
         where table_schema = current_schema() and table_name = 'candidato' and column_name in ('recebido_em', 'criado_em')
           and column_default like 'clock_timestamp()%')
union all
select 'candidato: situação, tipo, escala, experiência, cursos, sexo e valores conferidos',
       (select count(*) = 7 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'candidato' and k.contype = 'c'
           and k.conname in ('ck_candidato_situacao', 'ck_candidato_tipo', 'ck_candidato_escala', 'ck_candidato_experiencia',
                             'ck_candidato_cursos', 'ck_candidato_sexo', 'ck_candidato_valores'))
union all
select 'índices da lista, do expurgo, das experiências, dos cursos e do histórico',
       (select count(*) = 5 from pg_indexes x
         where x.schemaname = current_schema()
           and x.indexname in ('idx_candidato_lista', 'idx_candidato_expurgo', 'idx_candidato_experiencia',
                               'idx_candidato_curso', 'idx_candidato_evento'));
