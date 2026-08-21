-- @cloud-only
-- 198_campanha_instancia_tipo.sql — de qual número a campanha envia (F5b):
-- 'loja' (padrão, WhatsApp principal) ou 'marketing' (2º número). Só nuvem
-- (campanha é @cloud-only). Idempotente.

alter table campanha add column if not exists instancia_tipo text not null default 'loja';
