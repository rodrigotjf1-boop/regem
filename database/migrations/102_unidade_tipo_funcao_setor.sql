-- 102 — Fase B do modelo: tipo da unidade (Matriz/Filial) + função com N setores.

-- Unidade: Matriz | Filial. A mais antiga de cada tenant vira Matriz (as demais Filial).
alter table unidade add column if not exists tipo text not null default 'filial';
update unidade u set tipo = 'matriz'
where u.id = (
  select id from unidade u2
  where u2.tenant_id = u.tenant_id and u2.deleted_at is null
  order by created_at asc limit 1
);

-- Função ↔ setor N:N (a função pode servir vários setores). `funcao.setor_id`
-- segue como setor PRIMÁRIO (onboarding/geração de etiqueta); esta tabela guarda todos.
create table if not exists funcao_setor (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  funcao_id uuid not null references funcao(id) on delete cascade,
  setor_id uuid not null references setor(id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists uq_funcao_setor on funcao_setor (funcao_id, setor_id);
-- backfill: cada função com setor primário vira uma linha do N:N
insert into funcao_setor (tenant_id, funcao_id, setor_id)
select tenant_id, id, setor_id from funcao where setor_id is not null
on conflict do nothing;
