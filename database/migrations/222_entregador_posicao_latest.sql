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
delete from entregador_localizacao;
