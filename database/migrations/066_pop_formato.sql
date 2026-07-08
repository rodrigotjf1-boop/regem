-- 066_pop_formato.sql — POP & Guias: formato (listado/ilustrado) + estilo de
-- ilustração escolhido pelo usuário (guia a geração por IA).
-- ⚠️ ALTER — rodar no Supabase (apply-sql.mjs) e no local.

alter table guia add column if not exists formato text not null default 'listado';
alter table guia add column if not exists estilo_ilustracao text;
