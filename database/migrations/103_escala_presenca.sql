-- 103 — Falta/presença na escala.
-- Cada alocação (dia escalado) ganha um status de presença. Default 'prevista'
-- (ainda não marcada); o gestor marca presente / falta_justificada (com comprovante)
-- / falta_injustificada. Base do relatório de faltas por colaborador.

alter table escala_alocacao add column if not exists presenca text not null default 'prevista';
alter table escala_alocacao add column if not exists comprovante_ref text;   -- upload (atestado) na falta justificada
alter table escala_alocacao add column if not exists presenca_obs text;      -- motivo/observação
alter table escala_alocacao add column if not exists presenca_em timestamptz;
create index if not exists idx_escala_aloc_presenca on escala_alocacao (tenant_id, presenca);
