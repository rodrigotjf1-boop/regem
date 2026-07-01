-- 003_nucleo.sql
-- Fase 1 — Núcleo de valor: turnos/pico, escala por etiquetas, tarefas,
-- checklist -> POP, documentos controlados + ciência.

-- ===================== Tipos =====================
create type estado_publicacao as enum ('rascunho','pendente_aprovacao','vigente','arquivado');
create type tipo_alocacao      as enum ('titular','diarista','cobertura','avulso');
create type tipo_ausencia      as enum ('falta','atestado','folga');
create type origem_tarefa      as enum ('recorrente','avulsa');
create type estado_tarefa      as enum ('pendente','em_execucao','feita','parcial','nao_feita','impossibilitada');
create type tipo_documento     as enum ('regimento','treinamento','comunicado','outro');

-- ===================== Turno =====================
create table turno (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  unidade_id  uuid not null references unidade(id) on delete cascade,
  setor_id    uuid references setor(id) on delete cascade,   -- null = turno da unidade
  nome        text not null,
  hora_inicio time not null,
  hora_fim    time not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_turno_updated before update on turno
  for each row execute function set_updated_at();

-- ===================== Janela de pico =====================
create table janela_pico (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  unidade_id  uuid not null references unidade(id) on delete cascade,
  setor_id    uuid references setor(id) on delete cascade,   -- null = herda da unidade
  dia_semana  smallint not null check (dia_semana between 0 and 6),  -- 0=domingo
  hora_inicio time not null,
  hora_fim    time not null,
  intensidade text,                                          -- opcional: 'alto'|'medio'
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_janela_pico_updated before update on janela_pico
  for each row execute function set_updated_at();

-- ===================== Etiqueta (vaga/slot) =====================
create table etiqueta (
  id                        uuid primary key default gen_random_uuid(),
  tenant_id                 uuid not null references empresa(id) on delete cascade,
  unidade_id                uuid not null references unidade(id) on delete cascade,
  setor_id                  uuid not null references setor(id) on delete cascade,
  funcao_id                 uuid not null references funcao(id) on delete restrict,
  sigla                     text not null,                   -- ex.: 'AUXC'
  contador                  int  not null default 1,         -- ex.: 1 -> AUXC1
  cor                       text,                            -- null = deriva da categoria da função
  icone                     text,                            -- null = deriva do setor
  titular_padrao_colaborador_id uuid references colaborador(id) on delete set null,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  deleted_at                timestamptz,
  unique (unidade_id, sigla, contador)
);
create trigger trg_etiqueta_updated before update on etiqueta
  for each row execute function set_updated_at();

-- ===================== Escala (alocação por dia) =====================
create table escala_alocacao (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid not null references unidade(id) on delete cascade,
  data           date not null,
  turno_id       uuid not null references turno(id) on delete restrict,
  etiqueta_id    uuid not null references etiqueta(id) on delete cascade,
  colaborador_id uuid references colaborador(id) on delete set null,  -- null = vaga aberta
  tipo           tipo_alocacao not null default 'titular',
  status         text not null default 'ativa',
  observacao     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create trigger trg_escala_alocacao_updated before update on escala_alocacao
  for each row execute function set_updated_at();
-- uma etiqueta ocupada uma vez por data+turno (ignorando registros removidos)
create unique index uq_escala_etiqueta_dia
  on escala_alocacao (etiqueta_id, data, turno_id)
  where deleted_at is null;
create index idx_escala_unidade_data on escala_alocacao (unidade_id, data);

-- ===================== Ausência =====================
create table ausencia (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references empresa(id) on delete cascade,
  unidade_id            uuid references unidade(id) on delete set null,
  colaborador_id        uuid not null references colaborador(id) on delete cascade,
  data_inicio           date not null,
  data_fim              date not null,
  tipo                  tipo_ausencia not null,
  cobertura_alocacao_id uuid references escala_alocacao(id) on delete set null,
  observacao            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_ausencia_updated before update on ausencia
  for each row execute function set_updated_at();

-- ===================== Checklist (fonte) =====================
create table checklist (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  unidade_id  uuid not null references unidade(id) on delete cascade,
  setor_id    uuid references setor(id) on delete set null,
  nome        text not null,
  versao      int  not null default 1,
  estado      estado_publicacao not null default 'rascunho',
  autor_id    uuid references colaborador(id) on delete set null,
  aprovador_id uuid references colaborador(id) on delete set null,
  aprovado_em timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create trigger trg_checklist_updated before update on checklist
  for each row execute function set_updated_at();
create index idx_checklist_unidade_estado on checklist (unidade_id, estado);

create table checklist_item (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references empresa(id) on delete cascade,
  checklist_id uuid not null references checklist(id) on delete cascade,
  ordem        int  not null default 0,
  descricao    text not null,
  procedimento text,
  foto_ref     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_checklist_item_updated before update on checklist_item
  for each row execute function set_updated_at();
create index idx_checklist_item_checklist on checklist_item (checklist_id);

-- ===================== POP (artefato publicado do checklist) =====================
create table pop (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references empresa(id) on delete cascade,
  checklist_id      uuid not null references checklist(id) on delete cascade,
  versao            int  not null,
  conteudo_snapshot jsonb,
  publicado_em      timestamptz not null default now(),
  pdf_ref           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (checklist_id, versao)
);
create trigger trg_pop_updated before update on pop
  for each row execute function set_updated_at();

-- ===================== Tarefa (definição) =====================
create table tarefa_def (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references empresa(id) on delete cascade,
  unidade_id            uuid not null references unidade(id) on delete cascade,
  setor_id              uuid references setor(id) on delete set null,
  origem                origem_tarefa not null default 'avulsa',
  checklist_id          uuid references checklist(id) on delete set null,  -- quando origem=recorrente
  titulo                text not null,
  descricao             text,
  etiqueta_id           uuid references etiqueta(id) on delete set null,   -- vaga-alvo (late-binding)
  colaborador_override_id uuid references colaborador(id) on delete set null,
  recorrencia_tipo      text not null default 'avulsa',       -- 'diaria'|'semanal'|'dia_semana'|'mensal'|'avulsa'
  recorrencia_config    jsonb,
  horario               time,
  janela_turno_id       uuid references turno(id) on delete set null,
  proibida_no_pico      boolean not null default false,
  antecipavel           boolean not null default false,
  pop_id                uuid references pop(id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  deleted_at            timestamptz
);
create trigger trg_tarefa_def_updated before update on tarefa_def
  for each row execute function set_updated_at();
create index idx_tarefa_def_unidade on tarefa_def (unidade_id);

-- ===================== Tarefa (instância do dia) =====================
create table tarefa_instancia (
  id                     uuid primary key default gen_random_uuid(),
  tenant_id              uuid not null references empresa(id) on delete cascade,
  unidade_id             uuid not null references unidade(id) on delete cascade,
  tarefa_def_id          uuid references tarefa_def(id) on delete set null,  -- null = avulsa pura
  data                   date not null,
  etiqueta_id            uuid references etiqueta(id) on delete set null,
  colaborador_resolvido_id uuid references colaborador(id) on delete set null,
  estado                 estado_tarefa not null default 'pendente',
  motivo                 text,
  foto_ref               text,
  concluido_por_id       uuid references colaborador(id) on delete set null,
  concluido_em           timestamptz,
  conclusao_em_massa     boolean not null default false,
  justificativa_pico     text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);
create trigger trg_tarefa_instancia_updated before update on tarefa_instancia
  for each row execute function set_updated_at();
create index idx_tarefa_inst_unidade_data on tarefa_instancia (unidade_id, data);
create index idx_tarefa_inst_etiqueta_data on tarefa_instancia (etiqueta_id, data);

-- ===================== Documento controlado + ciência =====================
create table documento_controlado (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references empresa(id) on delete cascade,
  unidade_id   uuid references unidade(id) on delete cascade,      -- null = escopo empresa
  tipo         tipo_documento not null,
  titulo       text not null,
  escopo       text,
  versao       int  not null default 1,
  estado       estado_publicacao not null default 'rascunho',
  conteudo     jsonb,
  publicado_em timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  deleted_at   timestamptz
);
create trigger trg_documento_updated before update on documento_controlado
  for each row execute function set_updated_at();

create table ciencia (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  documento_id   uuid not null references documento_controlado(id) on delete cascade,
  versao         int  not null,
  data           timestamptz not null default now(),
  assinatura_ref text,
  unique (colaborador_id, documento_id, versao)
);
