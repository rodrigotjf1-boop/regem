-- 155 — fingerprint da máquina no dispositivo pareado (anti-clone).
-- Capturado no pareamento; amarra o token a um hardware específico. Aditiva.
alter table equipamento add column if not exists fingerprint text;
