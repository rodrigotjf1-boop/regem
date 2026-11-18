-- @cloud-only
-- 443 — MISTER: o LINK PARA ENCAMINHAR um relatório a quem não tem usuário (M3c, versão 3 do protótipo
-- `mockups/regem-mister.html`, aprovada pelo dono em 17/11/2026 — aba "Arquivos e links" › "A página do link" e a decisão
-- 7: "Para quem não tem usuário, só quando o presidente pede: link só de leitura, que vale 7 dias e fica na auditoria").
--
-- mister_link_publico — um relatório CONGELADO (o mesmo plano do PDF, como estava quando o presidente pediu) que abre sem
--   login pela página `/m/r/<código>`:
--   link_hash   — o resumo (sha256) do código do link; o código inteiro NUNCA fica guardado (como o link com PIN, mig 433)
--   plano       — os textos, os números e as barras do relatório (o plano do PDF). É uma FOTO: quem tem o link vê só o
--                 que o presidente viu naquela hora, nunca o dado vivo da loja
--   criado_por  — o presidente que pediu; o link só vale enquanto ele seguir presidente e ativo (a régua do acesso)
--   vence_em    — 7 dias depois; revogado_em — o presidente cancelou pela conversa
--   aberto_em   — a primeira vez que a página abriu (vai para a auditoria); acessos e ultimo_acesso_em — o uso
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (`mister_link_publico` em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as do Mister desde a 414).
set local lock_timeout = '5s';

create table if not exists mister_link_publico (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references empresa(id) on delete cascade,
  unidade_id       uuid,                                   -- a loja do relatório; NULL = todas as lojas (ou loja única)
  criado_por       uuid not null,
  tipo             text not null,
  titulo           text not null,
  nome_do_pdf      text not null,
  plano            jsonb not null,
  link_hash        text not null,
  criado_em        timestamptz not null default clock_timestamp(),
  vence_em         timestamptz not null,
  revogado_em      timestamptz,
  aberto_em        timestamptz,
  acessos          int not null default 0,
  ultimo_acesso_em timestamptz,
  constraint ck_mister_link_publico_tipo check (tipo in ('insumo')),
  constraint ck_mister_link_publico_validade check (vence_em > criado_em)
);
alter table mister_link_publico enable row level security;

create unique index if not exists uq_mister_link_publico_hash on mister_link_publico (link_hash);
-- Os links vivos da empresa (o teto por empresa e o "cancelar os links"): poucos por empresa.
create index if not exists ix_mister_link_publico_vivos on mister_link_publico (tenant_id, vence_em) where revogado_em is null;

comment on table mister_link_publico is 'Mister (mig 443): o relatório congelado que abre sem login pelo link para encaminhar — só nuvem';

-- Conferência (no mesmo Run).
do $$
begin
  if to_regclass('mister_link_publico') is null then raise exception 'mig 443: falta a tabela mister_link_publico'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_link_publico')) then
    raise exception 'mig 443: a RLS da mister_link_publico não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_link_publico'
         and column_name in ('id', 'tenant_id', 'unidade_id', 'criado_por', 'tipo', 'titulo', 'nome_do_pdf', 'plano', 'link_hash',
                             'criado_em', 'vence_em', 'revogado_em', 'aberto_em', 'acessos', 'ultimo_acesso_em')) <> 15 then
    raise exception 'mig 443: faltam colunas da mister_link_publico';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema() and tablename = 'mister_link_publico'
        and indexname in ('uq_mister_link_publico_hash', 'ix_mister_link_publico_vivos')) <> 2 then
    raise exception 'mig 443: faltam os índices da mister_link_publico';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('mister_link_publico')
        and conname in ('ck_mister_link_publico_tipo', 'ck_mister_link_publico_validade')) <> 2 then
    raise exception 'mig 443: faltam as restrições da mister_link_publico';
  end if;
end $$;
