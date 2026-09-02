-- 221 — Claim/lease anti-duplo-print na fila de impressão (P0).
-- impressao_job vive nos DOIS bancos (nuvem e edge) → NÃO é @cloud-only; roda nos dois.
-- Reserva atômica: o worker "pega" o job (status 'enviando' + claim_ate) ANTES de imprimir;
-- outro worker/poll só re-pega se a lease venceu (crash). Acaba com o duplo-print por dois
-- consumidores (via FOR UPDATE SKIP LOCKED no SELECT do claim) e com o reimprime-a-cada-ciclo
-- quando o ACK falha (o job fica 'enviando' até a lease vencer, não 'pendente').

alter table impressao_job add column if not exists claim_por text;
alter table impressao_job add column if not exists claim_ate timestamptz;

-- Fila + re-claim de leases vencidas: (status, claim_ate).
create index if not exists idx_impressao_claim on impressao_job (status, claim_ate);
