-- @cloud-only
-- 508 — MISTER: aprender pela tarefa feita (versão 10, fase C7; aprovada pelo dono em 25/11/2026 — `docs/plano-mister.md` §
-- "Versão 10", decisão V10-7; protótipo `mockups/regem-mister-v10.html`, "Aprende e sugere" e "Na loja" › Mister › O que aprendi).
--
--   mister_aprendizado  a tarefa que alguém confirmou e deu certo vira exemplo da EMPRESA: o pedido nas palavras da pessoa e o
--     que foi feito (o "Vou fazer" do Regem), sem dado pessoal. A próxima pergunta parecida recebe até 3 exemplos. A mesma
--     tarefa aprendida de novo atualiza a linha (a chave). O presidente vê e esquece em Mister › O que aprendi.
--   mister_conversa_config.aprender_tarefas  o ajuste "Aprender pela tarefa feita": sem custo, nasce DESLIGADO; só o presidente muda.
--
-- ⚠️ SÓ NUVEM: o Mister roda na nuvem; `mister_aprendizado` e `mister_conversa_config` são SO_NUVEM no sync-daemon, e o servidor
-- da loja pula o arquivo. Sem instrução destrutiva: vai pelo MCP (LIC-171). Idempotente; não apaga dado.
set local lock_timeout = '5s';

create table if not exists mister_aprendizado (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  colaborador_id  uuid,                                  -- quem ensinou (quem autorizou a tarefa)
  procedimento    text not null,                         -- a ação (`propor_acao`) ou a tarefa pelo mapa (`fazer_no_regem`)
  pedido          text not null,                         -- o pedido nas palavras da pessoa, sem dado pessoal (até 300 letras)
  feito           text not null,                         -- o que foi feito: o "Vou fazer" do Regem (até 600 letras)
  chave           text not null,                         -- a mesma tarefa aprendida de novo atualiza a linha
  criado_em       timestamptz not null default clock_timestamp(),
  atualizado_em   timestamptz not null default clock_timestamp(),
  usado_vezes     int not null default 0,
  usado_em        timestamptz,
  constraint uq_mister_aprendizado unique (tenant_id, chave)
);
create index if not exists ix_mister_aprendizado_empresa on mister_aprendizado (tenant_id, atualizado_em desc);
alter table mister_aprendizado enable row level security;

comment on table mister_aprendizado is 'Mister (mig 508, versão 10 C7): as tarefas que a empresa confirmou, como exemplo para as próximas — só nuvem';

alter table mister_conversa_config add column if not exists aprender_tarefas boolean not null default false;

comment on column mister_conversa_config.aprender_tarefas is
  'Versão 10, C7: "Aprender pela tarefa feita" — a tarefa confirmada vira exemplo da empresa. Sem custo; nasce desligado; só o presidente muda.';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas e a coluna do ajuste.
do $$
begin
  if to_regclass('mister_aprendizado') is null then raise exception 'mig 508: falta a tabela mister_aprendizado'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_aprendizado')) then
    raise exception 'mig 508: a RLS da mister_aprendizado não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_aprendizado'
         and column_name in ('id', 'tenant_id', 'colaborador_id', 'procedimento', 'pedido', 'feito', 'chave', 'criado_em',
                             'atualizado_em', 'usado_vezes', 'usado_em')) <> 11 then
    raise exception 'mig 508: faltam colunas na mister_aprendizado';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'aprender_tarefas') then
    raise exception 'mig 508: falta a coluna mister_conversa_config.aprender_tarefas';
  end if;
end $$;
