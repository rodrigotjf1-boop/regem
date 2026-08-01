-- 159 — Roteamento entre KDS (Fase E). Ao avançar um card no KDS de origem, ele pode
-- migrar para o "próximo KDS" da cadeia (ex.: Chapa → Montagem → Entrega). Opt-in:
-- sem proximo_kds_id configurado, o comportamento por setor continua igual.
alter table equipamento add column if not exists proximo_kds_id uuid;
