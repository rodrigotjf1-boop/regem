-- 154 — sequência de push por dispositivo (anti-omissão de sync).
-- O edge assina cada push (HMAC derivado do token) e envia um seq monotônico; a
-- nuvem guarda o último aceito aqui e alerta em gap/regressão. Aditiva.
alter table equipamento add column if not exists last_push_seq integer;
