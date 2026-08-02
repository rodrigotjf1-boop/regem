-- 160 — Horários de funcionamento SEPARADOS por tipo (delivery × retirada/local).
-- horario_unico = true (padrão): `horarios` vale para os dois. Quando false, a retirada
-- usa `horarios_retirada` (delivery continua em `horarios`).
alter table cardapio_config add column if not exists horarios_retirada jsonb not null default '[]'::jsonb;
alter table cardapio_config add column if not exists horario_unico boolean not null default true;
