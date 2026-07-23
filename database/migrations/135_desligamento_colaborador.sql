-- 135_desligamento_colaborador.sql — Desligamento de funcionário.
-- Aviso prévio (Art. 488 CLT: −2h/dia OU 7 dias corridos, só em dispensa SEM justa
-- causa; proporcional Lei 12.506/2011, teto 90) altera a escala automaticamente.
-- Justa causa/imediata: envia o relatório de ponto (AFD/espelho PDF) ao contador via
-- WhatsApp. Ponto retido 5 anos (Portaria 671 art. 140 §5). Idempotente.

-- ── Colaborador: dados do desligamento ──
alter table colaborador add column if not exists desligamento_tipo text;        -- sem_justa_causa | justa_causa | pedido_demissao | acordo | experiencia
alter table colaborador add column if not exists aviso_inicio date;             -- início do aviso prévio (trabalhado)
alter table colaborador add column if not exists aviso_opcao text;              -- '2h' (−2h/dia) | '7dias' (7 dias corridos no fim)
alter table colaborador add column if not exists aviso_fim date;                -- fim do aviso (30d + proporcional, teto 90)
alter table colaborador add column if not exists desligamento_data date;        -- data efetiva do desligamento
alter table colaborador add column if not exists desligamento_motivo text;
alter table colaborador add column if not exists desligamento_por_id uuid;      -- quem gerou (auditoria)
alter table colaborador add column if not exists desligado_em timestamptz;      -- efetivação (status vira 'desligado')
alter table colaborador add column if not exists ponto_enviado_em timestamptz;  -- envio do PDF ao contador
alter table colaborador add column if not exists ponto_enviado_contador_id uuid;

-- ── Contador (por tenant): destino do relatório de ponto no desligamento ──
create table if not exists contador (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  nome text not null,
  whatsapp text not null,               -- E.164 / número p/ o envio via bot
  email text,
  ativo boolean not null default true,
  cadastrado_por_id uuid,               -- confirmação de quem cadastra
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_contador_tenant on contador (tenant_id) where ativo;
