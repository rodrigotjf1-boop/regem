-- @cloud-only
-- 450 — O DMS GRAPH NO REGEM (G5a do plano "DMS Graph no Hub", aprovado pelo dono em 18/11/2026 com as recomendadas).
-- O atendente virtual manda a foto que o cliente mandou no WhatsApp ao DMS Graph (produto da DMS que analisa imagem) pela
-- porta MCP do Graph, e usa o JSON de volta; a IA da própria empresa (o caminho de hoje) fica de reserva (G-4). A ligação é
-- por EMPRESA (G-3) e nasce pelo clique do presidente (GR-2), com o MESMO contrato do clique do Orzuni (mig 416): o Regem
-- empurra o pedido ao Graph (RFC 9126 + PKCE, com o token do DMS ID do aplicativo do Regem e o `conta_empresa_id`), o
-- presidente autoriza na página do Graph, e na volta o Regem troca o código pelo segredo da ligação.
--
-- graph_ligacao — uma ligação VIVA por empresa (índice único parcial). `segredo_cifrado` = o `dms_lg_graph_…` que o Graph
--   entrega UMA vez, cifrado com a SEGREDOS_CHAVE da nuvem (`common/cifra-segredo.ts`), como o do Orzuni; nunca sai da
--   API. Quem ligou e quando; a conta da empresa no Graph; a FRANQUIA do mês vista por último (GR-5: o cartão mostra
--   "87 de 500 fotos neste mês" sem outra chamada); a última leitura (quando e como terminou). Desligada: quando, por quem,
--   por quê e a ORIGEM — `presidente` (desligou no Regem), `graph` (o Graph recusou a ligação: desfeita lá, GR-6 — o
--   Regem volta sozinho à IA da empresa) ou `troca` (um clique novo girou o segredo).
-- graph_clique_pedido — o pedido em curso, de uso único (como a `orzuni_clique_pedido`): do `state`, só o SHA-256; o
--   verificador do PKCE CIFRADO; quem começou (a volta só vale para essa pessoa); vence em 10 minutos.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as duas tabelas ficam em SO_NUVEM no sync-daemon). Quem fala com
-- o Graph é a nuvem (a leitura da foto e o clique). Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM
-- política (como a 370/416): fora do alcance da API REST anônima do Supabase.
set local lock_timeout = '5s';

create table if not exists graph_ligacao (
  id                         uuid primary key default gen_random_uuid(),
  tenant_id                  uuid not null references empresa(id) on delete cascade,
  segredo_cifrado            text not null,                        -- dms_lg_graph_… cifrado (v1:…); nunca sai da API
  prefixo                    text not null,                        -- a parte visível do segredo (para o suporte reconhecer)
  conta_graph                text,                                 -- conta_id no Graph (devolvido na troca)
  conta_graph_nome           text,                                 -- conta_nome no Graph (a tela mostra)
  permissoes                 jsonb not null default '[]'::jsonb,
  criada_em                  timestamptz not null default clock_timestamp(),
  criada_por                 text,                                 -- o nome de quem ligou (o presidente)
  criada_por_id              uuid,                                 -- o colaborador; sem FK: a pessoa pode sair
  segredo_em                 timestamptz not null default clock_timestamp(),
  ultimo_uso_em              timestamptz,                          -- a última foto LIDA pelo Graph
  ultima_leitura_em          timestamptz,                          -- a última tentativa (lida ou não)
  ultima_leitura_resultado   text,                                 -- lida | o motivo curto de não ter lido (sem conteúdo)
  franquia_mes               text,                                 -- 'AAAA-MM' (horário de Brasília, como o Graph)
  franquia_usados            integer,
  franquia_total             integer,
  franquia_em                timestamptz,                          -- quando a franquia veio
  revogada_em                timestamptz,
  revogada_origem            text,                                 -- presidente | graph | troca
  revogada_por               text,                                 -- o nome de quem desligou (ou 'DMS Graph')
  revogada_por_id            uuid,
  revogada_motivo            text,
  constraint ck_graph_ligacao_segredo check (segredo_cifrado like 'v1:%'),
  constraint ck_graph_ligacao_origem check (revogada_origem is null or revogada_origem in ('presidente', 'graph', 'troca')),
  constraint ck_graph_ligacao_mes check (franquia_mes is null or franquia_mes ~ '^[0-9]{4}-[0-9]{2}$')
);
create unique index if not exists uq_graph_ligacao_viva on graph_ligacao (tenant_id) where revogada_em is null;
create index if not exists idx_graph_ligacao_empresa on graph_ligacao (tenant_id, revogada_em desc);
alter table graph_ligacao enable row level security;

create table if not exists graph_clique_pedido (
  id                   uuid primary key default gen_random_uuid(),
  tenant_id            uuid not null references empresa(id) on delete cascade,
  colaborador_id       uuid not null,                       -- quem começou (o presidente); sem FK: a pessoa pode sair
  estado_hash          text not null,                       -- sha-256 do state; o state nunca é guardado
  verificador_cifrado  text not null,                       -- o code_verifier do PKCE, cifrado (v1:…)
  permissoes           jsonb not null default '[]'::jsonb,  -- o que o Regem pediu (GR-3: só arquivos.analisar)
  criado_em            timestamptz not null default clock_timestamp(),
  vence_em             timestamptz not null,
  concluido_em         timestamptz,
  resultado            text,                                -- ligada | recusado | vencido | erro
  constraint ck_graph_clique_pedido_cifra check (verificador_cifrado like 'v1:%')
);
create unique index if not exists uq_graph_clique_pedido_estado on graph_clique_pedido (estado_hash);
create index if not exists idx_graph_clique_pedido_vence on graph_clique_pedido (vence_em);
alter table graph_clique_pedido enable row level security;

comment on table graph_ligacao is 'DMS Graph (mig 450): a ligação da empresa com o Graph (segredo cifrado), a franquia vista por último e a última leitura — só nuvem';
comment on table graph_clique_pedido is 'DMS Graph (mig 450): o pedido de autorização por clique em curso, de uso único — só nuvem';

-- Conferência (no mesmo Run): as duas tabelas com RLS e o índice da ligação viva.
select 'graph_ligacao com RLS' as o_que,
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = current_schema() and c.relname = 'graph_ligacao'), false) as ok
union all
select 'graph_clique_pedido com RLS',
       coalesce((select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
                  where n.nspname = current_schema() and c.relname = 'graph_clique_pedido'), false)
union all
select 'uq_graph_ligacao_viva',
       exists (select 1 from pg_indexes where schemaname = current_schema() and indexname = 'uq_graph_ligacao_viva');
