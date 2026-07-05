-- Fase G-1 — Fundação fiscal NFC-e (modelo 65). SEFAZ direto, pronto p/ plugar.
-- O certificado A1 NÃO fica no banco (segredo): cert_ref aponta p/ caminho/refs
-- carregados no edge; aqui ficam só os dados fiscais e o CSC (do próprio emitente).

create table if not exists fiscal_config (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  ativo boolean not null default false,
  ambiente text not null default '2',      -- 1 = produção | 2 = homologação
  regime text not null default 'simples',  -- simples | normal
  crt integer not null default 1,          -- 1 Simples, 3 Normal (código CRT)
  serie integer not null default 1,
  proximo_numero integer not null default 1,
  cnpj text,
  razao_social text,
  nome_fantasia text,
  ie text,                                  -- inscrição estadual
  uf text,                                  -- sigla (SP, RJ…)
  codigo_uf integer,                        -- código IBGE da UF (35=SP…)
  codigo_municipio integer,                 -- código IBGE do município (7 díg)
  endereco text,
  csc_id text,                              -- idToken do CSC (NFC-e)
  csc_token text,                           -- CSC (segredo do emitente)
  cert_ref text,                            -- referência do certificado A1 (fora do banco)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_fiscal_config_tenant_unidade
  on fiscal_config(tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Campos fiscais no produto (padrões por regime; simples usa CSOSN, normal usa CST).
alter table produto add column if not exists ncm text;
alter table produto add column if not exists cfop text;
alter table produto add column if not exists cest text;
alter table produto add column if not exists origem text default '0';   -- 0..8
alter table produto add column if not exists csosn text default '102';  -- Simples
alter table produto add column if not exists cst_icms text;             -- Normal
alter table produto add column if not exists unidade_trib text;
alter table produto add column if not exists aliq_icms numeric;

-- Nota fiscal emitida (NFC-e modelo 65).
create table if not exists nota_fiscal (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  comanda_id uuid,
  modelo text not null default '65',
  serie integer not null,
  numero integer not null,
  chave text,                               -- 44 dígitos
  ambiente text not null default '2',
  status text not null default 'pendente',  -- pendente|autorizada|rejeitada|cancelada|contingencia
  protocolo text,
  motivo text,                              -- retorno da SEFAZ (cStat/xMotivo)
  qrcode text,
  xml text,                                 -- XML gerado (autorizado quando aprovado)
  valor_total numeric not null default 0,
  emitida_por_id uuid,
  emitida_em timestamptz,
  cancelada_em timestamptz,
  cancelada_por_id uuid,
  justificativa_cancelamento text,
  created_at timestamptz not null default now()
);
create index if not exists idx_nota_tenant_status on nota_fiscal(tenant_id, status);
create index if not exists idx_nota_comanda on nota_fiscal(comanda_id);
create unique index if not exists uq_nota_serie_numero
  on nota_fiscal(tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), modelo, serie, numero);
