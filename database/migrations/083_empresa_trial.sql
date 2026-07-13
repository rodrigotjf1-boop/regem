-- 083_empresa_trial.sql — Trial da conta na nuvem (G-1: bloqueio duro + trial).
-- Qualquer cadastro novo ganha trial_ate = hoje + 90 dias, plano 'completo'.
-- trial_ate NULL = conta SEM limite de teste (legado / assinatura ativa) -> nunca bloqueia.
-- Idempotente. Não mexe nas empresas já existentes (ficam com trial_ate NULL = ativas).

alter table empresa add column if not exists trial_ate timestamptz;
