-- 014_ponto_ajuste.sql — Fase E (gestão de ponto): ajustes/tratativas sobre o ponto.
-- Padrão 671: o registro original (ponto_marcacao) é IMUTÁVEL. Correções nunca
-- apagam — viram ajustes rastreáveis (com justificativa + autor + auditoria).
--   * marcação esquecida  → nova linha em ponto_marcacao (origem='ajuste')
--   * desconsideração      → ponto_ajuste (aponta a marcação; o espelho a ignora)
--   * abono / atestado     → ponto_ajuste (credita minutos / abona o dia)
-- CREATE limpo. ⚠️ ponto_ajuste é nova (rodar no Supabase SQL Editor).

create table if not exists ponto_ajuste (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  colaborador_id uuid not null references colaborador(id) on delete cascade,
  data date not null,
  tipo text not null,               -- desconsideracao | abono | atestado | justificativa
  marcacao_id uuid references ponto_marcacao(id),  -- para desconsideracao
  minutos int,                      -- crédito (abono/atestado); null = abona o esperado do dia
  justificativa text not null,
  atestado_ref text,                -- URL do atestado/comprovante (upload)
  autor_id uuid references colaborador(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_ponto_ajuste_colab on ponto_ajuste (colaborador_id, data);
create index if not exists idx_ponto_ajuste_tenant on ponto_ajuste (tenant_id);
