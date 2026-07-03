-- 026_mural_clima.sql — Mural (comunicados + leitura rastreável) e Clima (pesquisa ANÔNIMA).
-- ⚠️ CREATE — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.
--
-- Anonimidade do clima (LGPD): a RESPOSTA não guarda quem respondeu; a PARTICIPAÇÃO
-- (separada) dá a contagem "9/14" e trava o voto duplo, sem ligar pessoa → resposta.
-- A diretoria só vê o consolidado (agregado das respostas).

-- Mural — comunicados
create table if not exists comunicado (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  setor_id uuid,                       -- audiência 'setor' → restringe a este setor
  autor_colaborador_id uuid references colaborador(id),
  titulo text not null,
  corpo text,
  audiencia text not null default 'loja',   -- 'loja' | 'setor'
  fixado boolean not null default false,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_comunicado_tenant on comunicado (tenant_id, created_at desc);

-- Leitura rastreável — quem confirmou leitura de cada comunicado
create table if not exists comunicado_leitura (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  comunicado_id uuid not null references comunicado(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  lido_em timestamptz not null default now(),
  unique (comunicado_id, colaborador_id)
);

-- Clima — pesquisa (uma "campanha" por período)
create table if not exists clima_pesquisa (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  titulo text not null,
  aberta boolean not null default true,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists idx_clima_pesquisa_tenant on clima_pesquisa (tenant_id, created_at desc);

-- Resposta ANÔNIMA — humor 1..5 (1=muito ruim .. 5=muito bom) + comentário livre.
-- NÃO tem colaborador_id: impossível rastrear a resposta a uma pessoa.
create table if not exists clima_resposta (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  pesquisa_id uuid not null references clima_pesquisa(id) on delete cascade,
  humor int not null,
  comentario text,
  created_at timestamptz not null default now()
);
create index if not exists idx_clima_resposta_pesquisa on clima_resposta (pesquisa_id);

-- Participação — só marca QUE respondeu (contagem + trava voto duplo),
-- sem qualquer vínculo com o CONTEÚDO da resposta.
create table if not exists clima_participacao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  pesquisa_id uuid not null references clima_pesquisa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  respondeu_em timestamptz not null default now(),
  unique (pesquisa_id, colaborador_id)
);
