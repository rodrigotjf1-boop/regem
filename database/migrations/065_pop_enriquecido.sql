-- 065_pop_enriquecido.sql — POP & Guias: campos do modelo didático (RDC 216).
-- ⚠️ ALTER — rodar no Supabase (apply-sql.mjs) e no local.

alter table guia add column if not exists alcance text;
alter table guia add column if not exists responsavel_executa text;
alter table guia add column if not exists responsavel_supervisiona text;
alter table guia add column if not exists materiais text;
alter table guia add column if not exists revisao_meses integer default 12;
alter table guia add column if not exists logo_ref text;
