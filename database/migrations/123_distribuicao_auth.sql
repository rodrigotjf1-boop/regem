-- @cloud-only  (usuários e auditoria da DISTRIBUIÇÃO — só na nuvem, não vão à loja)
-- Console da distribuição — Fase 1: auth própria (realm separado das lojas) + perfis
-- (diretoria | tecnico | financeiro) + auditoria imutável das ações da distribuição.
create table if not exists usuario_distribuicao (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  email text not null unique,
  senha_hash text not null,
  perfil text not null default 'tecnico',   -- diretoria | tecnico | financeiro
  ativo boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create table if not exists distribuicao_auditoria (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid,
  usuario_nome text,
  perfil text,
  acao text not null,
  alvo text,
  detalhe jsonb not null default '{}',
  ip text,
  criado_em timestamptz not null default now()
);
create index if not exists distribuicao_auditoria_idx on distribuicao_auditoria(criado_em desc);
