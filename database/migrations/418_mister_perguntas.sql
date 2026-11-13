-- @cloud-only
-- 418 — MISTER: as PERGUNTAS (a fila e a trilha do agente de IA; F2 do plano em `docs/plano-mister.md`).
--
-- Quem está ligado ao Mister pergunta em português, pelo WhatsApp, sobre a loja dele. A mensagem entra numa FILA (o
-- webhook da Meta não espera a IA), um agente de IA responde com FERRAMENTAS DE LEITURA — cada uma chama o serviço que
-- já alimenta a tela do Regem, sempre na empresa e na loja de quem perguntou — e a resposta sai pelo número do Mister.
--
-- mister_pergunta — uma linha por pergunta: de quem (empresa, pessoa, a loja e o nível NA HORA), a mensagem que a trouxe
--   (`chave`, única: a mesma mensagem nunca entra duas vezes), a situação (na_fila → respondendo → respondida | falhou),
--   o motivo quando a IA não respondeu, e a TRILHA: o modelo, quantas chamadas, os tokens e as ferramentas usadas (só o
--   nome, o tempo e se deu certo — nunca o dado que a ferramenta trouxe).
--   O TEXTO da pergunta e da resposta fica aqui porque a conversa precisa dele (a pergunta seguinte, "e ontem?") e porque
--   é a trilha do que o Mister disse ao dono. Uma rotina diária apaga o texto com mais de 30 dias e a linha com mais de
--   90. É dado da empresa: a tabela tem a empresa em toda linha e não sai da nuvem.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como a 414, a 415 e a 417): fora do alcance
-- da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists mister_pergunta (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  colaborador_id     uuid not null references colaborador(id) on delete cascade,
  unidade_id         uuid,                               -- a loja da pessoa na hora (NULL = todas as lojas da empresa)
  nivel              text not null,                      -- presidente | gerente, na hora
  telefone           text not null,                      -- para onde a resposta volta (só dígitos)
  chave              text not null,                      -- a mensagem que trouxe a pergunta: nunca entra duas vezes
  wamid              text,                               -- o id da mensagem na Meta (para marcar como lida e "digitando")
  pergunta           text,                               -- NULL depois de 30 dias
  resposta           text,                               -- NULL depois de 30 dias
  situacao           text not null default 'na_fila',    -- na_fila | respondendo | respondida | falhou
  motivo             text,                               -- por que a IA não respondeu (sem_chave, limite, interrompida, …)
  tentativas         smallint not null default 0,
  pega_em            timestamptz,                        -- quando o agente a pegou (a pega vence: ver o serviço)
  respondida_em      timestamptz,
  modelo             text,
  chamadas           smallint not null default 0,        -- quantas vezes o modelo foi chamado para esta pergunta
  tokens_entrada     integer not null default 0,
  tokens_saida       integer not null default 0,
  ferramentas        jsonb not null default '[]'::jsonb, -- [{ nome, ms, ok }] — nunca o dado
  conferencia        jsonb not null default '[]'::jsonb, -- o que o filtro de saída anotou (link tirado, valor sem origem…)
  criado_em          timestamptz not null default clock_timestamp(),
  atualizado_em      timestamptz not null default now(),
  constraint ck_mister_pergunta_situacao check (situacao in ('na_fila', 'respondendo', 'respondida', 'falhou')),
  constraint ck_mister_pergunta_nivel check (nivel in ('presidente', 'gerente'))
);
create unique index if not exists uq_mister_pergunta_chave on mister_pergunta (chave);
-- A fila: só o que ainda espera ou está sendo respondido (o índice fica pequeno).
create index if not exists ix_mister_pergunta_fila on mister_pergunta (criado_em) where situacao in ('na_fila', 'respondendo');
-- A conversa de uma pessoa (a memória das últimas perguntas) e o teto de perguntas por pessoa e por empresa.
create index if not exists ix_mister_pergunta_conversa on mister_pergunta (tenant_id, colaborador_id, criado_em desc);
-- A limpeza diária.
create index if not exists ix_mister_pergunta_criado on mister_pergunta (criado_em);
alter table mister_pergunta enable row level security;

comment on table mister_pergunta is 'Mister (mig 418): a fila e a trilha das perguntas ao agente de IA — só nuvem; o texto sai em 30 dias, a linha em 90';

-- Conferência (no mesmo Run): a tabela (com RLS), as colunas, os índices e as duas restrições.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as detalhe
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname = 'mister_pergunta'
union all
select 'colunas', table_name, count(*)::text
  from information_schema.columns
 where table_schema = current_schema() and table_name = 'mister_pergunta'
 group by table_name
union all
select 'indice', indexname, tablename
  from pg_indexes
 where schemaname = current_schema() and tablename = 'mister_pergunta'
union all
select 'restricao', conname, contype::text
  from pg_constraint
 where conrelid = to_regclass('mister_pergunta') and contype = 'c'
 order by 1, 2;
