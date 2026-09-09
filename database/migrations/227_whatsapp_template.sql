-- @cloud-only — templates da API oficial vivem só na nuvem (o edge não fala com a Meta).
--
-- 227_whatsapp_template.sql — gestão LOCAL de templates da Cloud API (Opção B: criar/
-- editar/submeter pelo Regem + acompanhar aprovação). Marketing fora da janela de 24h
-- exige template categoria MARKETING aprovado. Também liga a campanha 'cloud' a um
-- template + mapa de variáveis. Tudo aditivo/idempotente.

create table if not exists whatsapp_template (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  nome           text not null,                       -- nome técnico (minúsculas/underscore)
  categoria      text not null default 'MARKETING',   -- MARKETING | UTILITY | AUTHENTICATION
  idioma         text not null default 'pt_BR',
  cabecalho      text,                                 -- header de TEXTO (opcional)
  corpo          text not null,                        -- body com {{1}}, {{2}}…
  rodape         text,                                 -- footer (opcional)
  exemplo        jsonb,                                -- valores de exemplo das variáveis (Meta exige)
  status         text not null default 'rascunho',     -- rascunho|pendente|aprovado|rejeitado|pausado
  meta_id        text,                                 -- id do template na Meta
  motivo_rejeicao text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create unique index if not exists uq_whatsapp_template_nome on whatsapp_template (tenant_id, nome, idioma);
create index if not exists idx_whatsapp_template_tenant on whatsapp_template (tenant_id);

-- Campanha 'cloud' referencia um template aprovado + mapa de variáveis (índice {{n}} -> campo).
alter table campanha add column if not exists template_nome text;
alter table campanha add column if not exists template_idioma text;
alter table campanha add column if not exists template_vars jsonb; -- ex.: {"1":"nome"}
