-- OTP protegido: o banco guarda só o HASH SHA-256 do código, nunca o texto puro.
-- O código em claro existe apenas no payload do webhook de envio (n8n/Evolution).
alter table cliente_otp add column if not exists codigo_hash text;
-- para de exigir/gravar o código em texto puro
alter table cliente_otp alter column codigo drop not null;
