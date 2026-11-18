-- @cloud-only
-- 444 — MISTER: o RECADO NO MURAL pela conversa (M3g parte 2, versão 3 do protótipo `mockups/regem-mister.html`, aprovada
-- pelo dono em 17/11/2026 — conversa 22, "Corrigir e criar", e a decisão "Criar e publicar (recado no mural, por exemplo):
-- ele mostra o texto e pergunta antes").
--
-- mister_recado — o RASCUNHO que o Mister escreveu a pedido do presidente ou do gerente, esperando o toque:
--   situacao  — rascunho (esperando "Publicar" ou "Mudar o texto") → publicado | descartado (trocado ou "Mudar o texto").
--               O vencido não muda de situação: o toque confere `vence_em` (30 minutos).
--   texto     — o recado como vai ao mural (até 500 letras); loja_nome — onde vai, para a resposta
--   unidade_id — a loja do mural (NULL = todas as lojas da empresa)
--   colaborador_id — quem pediu; só ele publica, pelo botão da conversa dele
--   comunicado_id — o comunicado que o "Publicar" criou (pelo MESMO serviço da tela do Mural & clima)
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (`mister_recado` em SO_NUVEM no sync-daemon). O comunicado
-- publicado desce para a loja pelo sync de sempre (`comunicado`, nos dois sentidos).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as do Mister desde a 414).
set local lock_timeout = '5s';

create table if not exists mister_recado (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid,                                   -- a loja do mural; NULL = todas as lojas
  colaborador_id uuid not null,                          -- quem pediu (presidente ou gerente)
  texto          text not null,
  loja_nome      text not null,
  situacao       text not null default 'rascunho',
  criado_em      timestamptz not null default clock_timestamp(),
  vence_em       timestamptz not null,
  respondido_em  timestamptz,
  comunicado_id  uuid,
  constraint ck_mister_recado_situacao check (situacao in ('rascunho', 'publicado', 'descartado')),
  constraint ck_mister_recado_texto check (char_length(texto) between 2 and 500),
  constraint ck_mister_recado_validade check (vence_em > criado_em)
);
alter table mister_recado enable row level security;

-- O rascunho de cada pessoa (o novo descarta o anterior): poucos por pessoa.
create index if not exists ix_mister_recado_rascunho on mister_recado (tenant_id, colaborador_id) where situacao = 'rascunho';
create index if not exists ix_mister_recado_empresa on mister_recado (tenant_id, criado_em desc);

comment on table mister_recado is 'Mister (mig 444): o rascunho do recado no mural que espera o "Publicar" — só nuvem';

-- Conferência (no mesmo Run).
do $$
begin
  if to_regclass('mister_recado') is null then raise exception 'mig 444: falta a tabela mister_recado'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_recado')) then
    raise exception 'mig 444: a RLS da mister_recado não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_recado'
         and column_name in ('id', 'tenant_id', 'unidade_id', 'colaborador_id', 'texto', 'loja_nome', 'situacao', 'criado_em',
                             'vence_em', 'respondido_em', 'comunicado_id')) <> 11 then
    raise exception 'mig 444: faltam colunas da mister_recado';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema() and tablename = 'mister_recado'
        and indexname in ('ix_mister_recado_rascunho', 'ix_mister_recado_empresa')) <> 2 then
    raise exception 'mig 444: faltam os índices da mister_recado';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('mister_recado')
        and conname in ('ck_mister_recado_situacao', 'ck_mister_recado_texto', 'ck_mister_recado_validade')) <> 3 then
    raise exception 'mig 444: faltam as restrições da mister_recado';
  end if;
end $$;
