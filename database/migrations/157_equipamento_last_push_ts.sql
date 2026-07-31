-- 157 — maior timestamp de push já visto por dispositivo (anti-rollback de relógio).
-- Se um push chega com ts < last_push_ts, alertamos (relógio do edge voltou —
-- possível backdating). Aditiva.
alter table equipamento add column if not exists last_push_ts timestamptz;
