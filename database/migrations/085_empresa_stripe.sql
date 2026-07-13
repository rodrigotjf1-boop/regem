-- 085_empresa_stripe.sql — Assinatura via Stripe (G-6b).
-- Guarda a referência do cliente/assinatura no Stripe e o status da assinatura.
-- O "válido até" continua no trial_ate (vira o fim do período pago). Idempotente.

alter table empresa add column if not exists stripe_customer_id text;
alter table empresa add column if not exists stripe_subscription_id text;
alter table empresa add column if not exists assinatura_status text; -- active|trialing|past_due|canceled|null
