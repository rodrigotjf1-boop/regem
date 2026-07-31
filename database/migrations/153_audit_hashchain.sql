-- 153 — cadeia à prova de adulteração no audit_log (append-only + hash-chain).
-- seq: sequência monotônica por tenant. prev_hash/hash: encadeamento SHA-256.
-- hash = sha256(prev_hash | registro_canônico). Alterar/remover um registro quebra
-- a cadeia (o próximo prev_hash não bate) — detectável por AuditoriaService.verificarCadeia.
-- Registros ANTERIORES à migration ficam com seq/hash NULL (legado, fora da cadeia);
-- a proteção vale da migration em diante.
alter table audit_log add column if not exists seq integer;
alter table audit_log add column if not exists prev_hash text;
alter table audit_log add column if not exists hash text;
create index if not exists idx_audit_tenant_seq on audit_log (tenant_id, seq);
