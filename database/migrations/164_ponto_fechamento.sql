-- 164 — Fechamento mensal de ponto (Épico #2, espelho de ponto / RH).
-- No 1º dia de cada mês um job levanta os colaboradores ESCALADOS no mês anterior,
-- puxa as marcações e detecta PENDÊNCIAS (batida faltando/incompleta em dia escalado
-- sem abono/atestado). Guarda um registro por (tenant, competência) = 1º dia do mês
-- fechado. Vira o "alerta de pendências" em Gerenciamento de ponto; quando zerado,
-- oferece encaminhar o espelho (PDF) ao RH (contador) por WhatsApp.
-- status: pendente (há pendências a corrigir) | ok (limpo) | enviado (espelho já enviado).
create table if not exists ponto_fechamento (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  competencia date not null,                       -- 1º dia do mês fechado (ex.: 2026-07-01)
  status text not null default 'pendente',         -- pendente | ok | enviado
  total_colaboradores integer not null default 0,
  total_pendencias integer not null default 0,
  pendencias jsonb not null default '[]'::jsonb,    -- [{colaboradorId,nome,dias:[{data,motivo}]}]
  pdf_ref text,                                     -- referência do PDF gerado (opcional)
  enviado_em timestamptz,
  enviado_contador_id uuid,
  enviado_por_id uuid,
  criado_em timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Idempotência do job: um fechamento por mês por empresa.
create unique index if not exists uq_ponto_fechamento_comp
  on ponto_fechamento (tenant_id, competencia);
