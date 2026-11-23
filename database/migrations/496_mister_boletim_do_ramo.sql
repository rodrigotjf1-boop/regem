-- @cloud-only
-- 496 · O BOLETIM DO RAMO NO MISTER (fase N2 do protótipo `mockups/regem-noticias-do-ramo.html`, aprovado em 22/11/2026).
-- O relatório `boletim_ramo` usa a mesma tabela dos outros relatórios (`mister_relatorio_regra`, mig 420). A coluna nova é a
-- escolha da empresa para quem não falou com o Mister nas últimas 24 horas: nasce `false` (não manda o convite pago e a
-- pessoa lê na tela). Só o boletim lê esta coluna; os outros relatórios seguem com o convite de sempre.
--
-- Sem instrução destrutiva (MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

alter table mister_relatorio_regra add column if not exists convidar_fora boolean not null default false;
