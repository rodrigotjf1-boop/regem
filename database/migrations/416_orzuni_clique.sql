-- @cloud-only
-- 416 — O CLIQUE REGEM → ORZUNI (plano "Clique Regem → Orzuni", parte R2; aprovado pelo dono em 13/11/2026, decisões
-- OZ-1 a OZ-7). O presidente liga a loja ao Orzuni sozinho: o Regem empurra o pedido de autorização ao Orzuni (RFC
-- 9126, com o token do DMS ID do aplicativo), o presidente autoriza na página do Orzuni, e na volta o Regem troca o
-- código pela ligação — a MESMA `orzuni_ligacao` de hoje (a do console da distribuição), então o envio não muda.
--
-- orzuni_clique_pedido — o pedido em curso, de uso único: o `state` (só o SHA-256; o state viaja no navegador), o
--   verificador do PKCE CIFRADO (`common/cifra-segredo.ts`, a SEGREDOS_CHAVE desta nuvem), a loja, quem começou (a
--   volta só vale para essa pessoa: o state preso à sessão, Padrão §3) e o que foi pedido. Vence em 10 minutos.
-- orzuni_ligacao ganha `origem` (chave = registrada no console; clique = autorizada pelo presidente) e o nome da loja do
--   iFood, que a tela mostra.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela nova fica em SO_NUVEM no sync-daemon; a ligação já
-- é só da nuvem desde a 370). Idempotente; nada que apague objeto (LIC-171).
-- RLS ligada e SEM política (como a 370/415): fora do alcance da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists orzuni_clique_pedido (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references empresa(id) on delete cascade,
  unidade_id           uuid not null references unidade(id) on delete cascade,
  colaborador_id       uuid not null,                       -- quem começou (o presidente); sem FK: a pessoa pode sair
  estado_hash          text not null,                       -- sha-256 do state; o state nunca é guardado
  verificador_cifrado  text not null,                       -- o code_verifier do PKCE, cifrado (v1:…)
  permissoes           jsonb not null default '[]'::jsonb,  -- o que o Regem pediu
  modo                 text not null default 'novo',        -- novo | mais
  criado_em            timestamptz not null default now(),
  vence_em             timestamptz not null,
  concluido_em         timestamptz,
  resultado            text,                                -- ligada | recusado | vencido | erro
  constraint ck_orzuni_clique_pedido_cifra check (verificador_cifrado like 'v1:%'),
  constraint ck_orzuni_clique_pedido_modo check (modo in ('novo', 'mais'))
);
create unique index if not exists uq_orzuni_clique_pedido_estado on orzuni_clique_pedido (estado_hash);
create index if not exists idx_orzuni_clique_pedido_vence on orzuni_clique_pedido (vence_em);
alter table orzuni_clique_pedido enable row level security;

alter table orzuni_ligacao add column if not exists origem text not null default 'chave';  -- chave | clique
alter table orzuni_ligacao add column if not exists loja_ifood_nome text;                  -- o nome da loja no iFood

comment on table orzuni_clique_pedido is 'Clique Regem → Orzuni (mig 416): o pedido de autorização em curso, de uso único — só nuvem';

-- Conferência (no mesmo Run): a tabela nova com RLS e as duas colunas novas da ligação.
select 'orzuni_clique_pedido com RLS' as o_que,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = current_schema() and c.relname = 'orzuni_clique_pedido'), false) as ok
union all
select 'orzuni_ligacao.origem e .loja_ifood_nome',
       (select count(*) = 2 from information_schema.columns
         where table_schema = current_schema() and table_name = 'orzuni_ligacao' and column_name in ('origem', 'loja_ifood_nome'));
