-- @cloud-only  Telemetria: permitir erro "global da nuvem" (sem tenant) para a
-- distribuição ter ciência de falhas de servidor/jobs que não têm loja associada.
-- tenant_id passa a aceitar NULL (a FK continua e simplesmente não se aplica a NULL);
-- o dedup passa a tratar NULL como um bucket único, via índice por EXPRESSÃO
-- (coalesce), casando com o on conflict do registrarTelemetria.
alter table telemetria_evento alter column tenant_id drop not null;

drop index if exists telemetria_evento_dedup;
create unique index if not exists telemetria_evento_dedup
  on telemetria_evento (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), hash);
