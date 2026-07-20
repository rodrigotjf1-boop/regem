-- 130_ordem_producao.sql — ORDEM DE PRODUÇÃO (produção interna a partir de ficha).
-- É o "pedido de produção": o PLANO (o que, quanto, quando, quem). A execução em si
-- continua sendo o `produzir()` (explosão da ficha → baixa insumos + entrada do
-- produzido), disparado na CONCLUSÃO com a quantidade REAL.
-- Cobre as 3 fases (núcleo, canais, recorrência) numa migration só. Idempotente.

-- ── Ficha: tamanho da porção → converte porções (un) ↔ rendimento da ficha ──
-- Ex.: rendimento 1000 ml + porção 100 ml => a ficha rende 10 porções.
-- Sem porção definida, a quantidade da ordem é tratada como múltiplo da ficha.
alter table ficha_tecnica add column if not exists porcao_tamanho numeric;
alter table ficha_tecnica add column if not exists porcao_unidade text;

create table if not exists ordem_producao (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,

  -- O QUÊ
  ficha_id uuid not null references ficha_tecnica(id) on delete cascade,
  item_saida_id uuid,                                  -- insumo que recebe a entrada
  quantidade_planejada numeric not null default 1,     -- em `unidade` (padrão: porções/un)
  quantidade_produzida numeric,                        -- o REAL, informado na conclusão
  unidade text not null default 'un',

  -- QUANDO
  data_producao date not null,
  hora_inicio time,
  hora_fim time,

  -- QUEM (responsável opcional; sem ele a ordem fica à disposição do setor)
  setor_id uuid,
  funcao_id uuid,
  colaborador_id uuid,

  -- ESTADO
  -- planejada | liberada | em_producao | concluida_total | concluida_parcial
  -- | nao_concluida | aguardando_lancamento | pendencia_critica | cancelada
  status text not null default 'planejada',
  iniciada_em timestamptz,
  concluida_em timestamptz,
  concluida_por_id uuid,          -- assinatura digital (confirmada por PIN)
  motivo text,                    -- não conclusão / cancelamento
  obs text,
  ref_id uuid,                    -- idempotência do produzir()

  -- CANAIS (fase 2) — ["app","kds","linha_tempo","impressao"]
  canais jsonb not null default '[]',
  kds_equipamento_id uuid,        -- KDS específico já cadastrado (a loja escolhe)
  impressora_id uuid,             -- impressora térmica da via de produção
  tarefa_instancia_id uuid,       -- vínculo com a linha do tempo

  -- RECORRÊNCIA (fase 3) — reaproveita o motor de tarefa_def
  tarefa_def_id uuid,

  criado_por_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index if not exists idx_ordem_prod_data on ordem_producao (tenant_id, data_producao);
create index if not exists idx_ordem_prod_status on ordem_producao (tenant_id, status);
create index if not exists idx_ordem_prod_ficha on ordem_producao (ficha_id);
-- Uma ordem por definição recorrente por dia (evita duplicar na geração diária).
create unique index if not exists uq_ordem_prod_def_dia
  on ordem_producao (tenant_id, tarefa_def_id, data_producao)
  where tarefa_def_id is not null and deleted_at is null;
