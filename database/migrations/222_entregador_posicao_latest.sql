-- 222 — Rastreio de localização "latest-only" (opção 1 de escala): 1 linha por entregador
-- (UPSERT a cada ping) em vez de INSERT-por-ping. Reduz a carga de escrita e acaba com o
-- crescimento da entregador_localizacao. Todos os usos leem só a ÚLTIMA posição (rastreio do
-- cliente, rota do app, mapa ao vivo do gestor, geofence). Opção 2 (Realtime) e 3 (Redis/
-- time-series) ficam pra 200+ lojas. Cloud-only na prática (o app posta na nuvem); a tabela
-- pode existir no edge (inerte — os endpoints do entregador são @CloudOnly).

create table if not exists entregador_posicao (
  colaborador_id uuid primary key,
  tenant_id uuid not null,
  lat numeric not null,
  lng numeric not null,
  precisao numeric,
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_entregador_posicao_tenant on entregador_posicao (tenant_id, atualizado_em);

-- Legado: a entregador_localizacao (INSERT-por-ping) não é mais usada — drena os dados antigos.
-- GUARDA: entregador_localizacao é cloud-only (mig 200 = @cloud-only) e NÃO existe no edge — o
-- delete direto quebrava com 42P01 e ABORTAVA toda a atualização do edge. Só drena se existir
-- (na nuvem existe → drena; no edge não existe → pula, sem erro).
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'entregador_localizacao'
  ) then
    delete from entregador_localizacao;
  end if;
end $$;
