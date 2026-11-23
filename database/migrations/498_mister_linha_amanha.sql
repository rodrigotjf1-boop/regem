-- @cloud-only
-- 498 — MISTER: a linha "Amanhã" no fim do resumo do dia (versão 8, E3; protótipo `mockups/regem-mister-v8.html`, "Clima e
-- eventos"). Texto fixo, sem IA, só quando há algo para dizer. Nasce desligada. Só o resumo do dia lê esta coluna.
--
-- O "Avisar na véspera" é um relatório a mais (`tipo = 'vespera'`) na mesma tabela da mig 420, sem coluna nova: usa o
-- `convidar_fora` da mig 496 (fora das 24 horas, sem convite não sai e não custa nada).
--
-- ⚠️ SÓ NUVEM: a tabela está em SO_NUVEM no sync-daemon. Sem instrução destrutiva (MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

alter table mister_relatorio_regra add column if not exists linha_amanha boolean not null default false;

comment on column mister_relatorio_regra.linha_amanha is 'Mister v8 (mig 498): o resumo do dia termina com a linha "Amanhã", quando há algo para dizer';

-- Conferência (no mesmo Run).
select column_name, data_type, column_default, is_nullable
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'mister_relatorio_regra' and column_name = 'linha_amanha';
