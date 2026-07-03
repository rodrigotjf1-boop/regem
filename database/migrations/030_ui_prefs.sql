-- 030_ui_prefs.sql — Preferências de UI por colaborador (shell: recolher, lado).
-- ⚠️ ALTER — rodar no Supabase SQL Editor (ou apply-sql.mjs) ANTES do deploy.
-- Sincroniza a UI entre dispositivos (o localStorage é só cache de paint).

alter table colaborador
  add column if not exists ui_prefs jsonb not null default '{}'::jsonb;
