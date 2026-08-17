-- @cloud-only
-- =====================================================================================
-- Verificação de e-mail no cadastro self-service (landing).
-- =====================================================================================
-- O cadastro só vira conta real (empresa/unidade/presidente) DEPOIS que o dono
-- confirma o código de 6 dígitos enviado por e-mail. Até lá, os dados ficam aqui.
-- Assim um e-mail inválido/de terceiro NÃO cria conta nem "queima" o CNPJ (o CNPJ é
-- a âncora anti-burla do trial — 1 trial por CNPJ). @cloud-only: signup é só na nuvem.
-- Idempotente.
create table if not exists cadastro_pendente (
  id           uuid primary key default gen_random_uuid(),
  email        text not null,
  cnpj         text not null,               -- só dígitos
  codigo_hash  text not null,               -- bcrypt do código de 6 dígitos
  payload      jsonb not null,              -- {empresaNome, cnpj, nome, usuario, senhaHash, endereco}
  tentativas   int  not null default 0,     -- tentativas de código erradas (trava em N)
  expira_em    timestamptz not null,        -- validade do código (ex.: +15 min)
  reenviado_em timestamptz,                 -- rate-limit de reenvio
  criado_em    timestamptz not null default now()
);
create index if not exists ix_cadastro_pendente_email on cadastro_pendente (lower(email));
create index if not exists ix_cadastro_pendente_cnpj  on cadastro_pendente (cnpj);
