-- @cloud-only
-- 478 — MISTER: os padrões que ele percebe e as sugestões (versão 6, fase M6f parte 2; plano aprovado em 20/11/2026,
-- `docs/plano-mister.md` § "Versão 6", "Padrões (a parte que aprende)"; protótipo `mockups/regem-mister-v6.html`, "Regras",
-- conversas 8 e 9; decisão V6-12). A 476 é a da sessão com PIN (M6d); a 477 é de outra sessão (o Clube).
--
-- Pelo código e sem IA, uma vez por dia (de manhã, com o que aconteceu até ontem), o Mister acha três padrões:
--   impressora_antes_do_fechamento — a impressora parou dentro do horário da loja e não voltou até fechar, em 3 ou mais
--                                     dos últimos 14 dias (os incidentes do vigia × o horário do cardápio);
--   avisos_sem_resposta            — ontem a pessoa recebeu 10 ou mais avisos de pedido parado e não respondeu a nenhum;
--   atrasos_na_faixa               — os pedidos que demoram para ficar pronto se juntam na mesma faixa de horário.
-- E sugere, uma vez: a regra (pela M6e, que só liga no "Confirmar"), o recado no mural (a impressora) ou "Não, deixa
-- assim", que cala aquele padrão por 30 dias. O Mister NUNCA muda uma regra sozinho.
--
-- mister_padrao — UMA linha por pessoa, tipo e alvo (o índice único): a sugestão que saiu e a resposta.
--   chave       o alvo dentro do tipo: impressora:<chave do vigia> · aviso:pedido_parado · atrasos:<loja>
--   dados       os números do padrão (dias, faixa, quantos avisos), sem dado pessoal
--   situacao    enviado | regra (propôs a regra) | recado (escreveu o recado) | calado ("Não, deixa assim") | falhou
--   proxima_em  antes disso o mesmo padrão não volta a esta pessoa (30 dias depois da sugestão ou da resposta)
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (SO_NUVEM no sync-daemon). Idempotente; nada que apague objeto
-- (LIC-171). RLS ligada e SEM política: fora do alcance da API REST anônima.
set local lock_timeout = '5s';

create table if not exists mister_padrao (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references empresa(id) on delete cascade,
  colaborador_id   uuid not null references colaborador(id) on delete cascade,
  unidade_id       uuid,
  tipo             text not null,
  chave            text not null,
  dados            jsonb not null default '{}'::jsonb,
  situacao         text not null default 'enviado',
  enviado_em       timestamptz not null default clock_timestamp(),
  respondido_em    timestamptz,
  proxima_em       timestamptz not null,
  constraint ck_mister_padrao_tipo check (tipo in ('impressora_antes_do_fechamento', 'avisos_sem_resposta', 'atrasos_na_faixa')),
  constraint ck_mister_padrao_situacao check (situacao in ('enviado', 'regra', 'recado', 'calado', 'falhou'))
);
-- Um padrão por pessoa e alvo: a sugestão seguinte do mesmo padrão reaproveita a linha (e só sai depois de `proxima_em`).
create unique index if not exists uq_mister_padrao on mister_padrao (tenant_id, colaborador_id, tipo, chave);
-- "Já recebeu uma sugestão hoje?" (uma por pessoa por dia).
create index if not exists idx_mister_padrao_pessoa on mister_padrao (tenant_id, colaborador_id, enviado_em desc);
alter table mister_padrao enable row level security;

comment on table mister_padrao is 'Mister v6 (mig 478): os padrões que o Mister percebe e a resposta de cada pessoa às sugestões — só nuvem';

-- Conferência (no mesmo Run): a tabela (com RLS), as travas e os índices.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname = 'mister_padrao' and c.relkind = 'r'
union all
select 'trava', conname, null from pg_constraint where conname in ('ck_mister_padrao_tipo', 'ck_mister_padrao_situacao')
union all
select 'indice', indexname, null from pg_indexes where schemaname = current_schema() and indexname in ('uq_mister_padrao', 'idx_mister_padrao_pessoa')
 order by 1, 2;
