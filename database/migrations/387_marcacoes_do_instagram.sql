-- @cloud-only
-- 387 · AS MARCAÇÕES DO INSTAGRAM (09/11/2026 — protótipo `mockups/regem-central-atendimento.html` versão 18). Pedido do
-- dono: "o atendente consegue interagir quando alguém marca a loja? a pessoa fez um vídeo ou uma foto e marca a loja… a
-- análise do vídeo ou da foto pela nossa API da Anthropic e responder ou comentar".
--
-- O que entra:
--   instagram_marcacao — uma linha por marcação da loja:
--     • 'story' = a menção no story (chega no Direct como `story_mention`; `origem_id` = o id da mensagem). O atendente
--       virtual agradece no Direct (`agradecida`), vira caso quando parece reclamação (`caso`) ou não faz nada porque a
--       conversa está com alguém (`sem_acao`). O endereço do story NÃO fica aqui (a Meta proíbe guardar a mídia; o
--       endereço já está na mensagem do Direct).
--     • 'post' | 'reels' | 'comentario' = o @ da loja no post, no reels ou no comentário de OUTRA pessoa (chega no aviso
--       `comments`; `origem_id` = o id do comentário, ou o da mídia quando o @ foi na legenda). Fica `sugerida` até a equipe
--       publicar (`publicada`) ou ignorar (`ignorada`).
--     `ia_viu` / `ia_clima` = o que a IA da distribuição descreveu (o produto, o lugar, o clima — nunca pessoas) e se parece
--     elogio, neutro ou reclamação; `sugestao` = o texto que ela escreveu. `resposta_por` = 'robo' (o agradecimento da IA),
--     'padrao' (o texto padrão: vídeo, sem a IA, a imagem não baixou) ou 'equipe'. A trava contra a publicação em dobro é
--     o `estado` (a troca condicional `sugerida → publicada`). Uma marcação por origem: (tenant_id, tipo, origem_id) único
--     — o aviso repetido não entra duas vezes (V24).
--   instagram_conta.marcacao_story / marcacao_post — "Agradecer quem marca a loja no story" e "Sugerir comentário nas
--     marcações" (nascem DESLIGADOS).
--
-- Só NUVEM (o aviso da Meta, o acesso e a IA moram lá; a tela do servidor da loja pede à nuvem) — `SO_NUVEM` no
-- `sync-daemon.mjs`. Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Só FKs da tabela nova.
-- O `lock_timeout` desiste em vez de enfileirar escrita atrás da `instagram_conta`.
set local lock_timeout = '5s';

alter table instagram_conta add column if not exists marcacao_story boolean not null default false;
alter table instagram_conta add column if not exists marcacao_post boolean not null default false;

create table if not exists instagram_marcacao (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  ig_user_id         text not null,                       -- a conta da loja (o histórico fica depois de desconectar)
  tipo               text not null,
  origem_id          text not null,                       -- story: o id da mensagem; comentário: o do comentário; legenda: o da mídia
  midia_id           text,
  midia_produto      text,                                -- FEED, REELS… (media_product_type)
  midia_link         text,                                -- o permalink (nada no story)
  legenda            text,                                -- a legenda do post marcado
  autor_id           text,                                -- o IGSID (story) ou o id de quem comentou
  autor_usuario      text,                                -- o @, sem o @
  texto              text,                                -- o comentário que marcou (nada no story)
  ia_viu             text,
  ia_clima           text,
  ia_modelo          text,
  sugestao           text,
  estado             text not null default 'sugerida',
  resposta_texto     text,
  resposta_id        text,                                -- o id da mensagem no Direct ou do comentário publicado
  resposta_por       text,
  respondido_por     uuid,                                -- o colaborador (a equipe)
  respondido_em      timestamptz,
  chamado_id         uuid references atendimento_chamado(id) on delete set null,
  erro               text,
  marcado_em         timestamptz not null,
  criado_em          timestamptz not null default clock_timestamp(),
  atualizado_em      timestamptz not null default clock_timestamp(),
  constraint uq_instagram_marcacao_origem unique (tenant_id, tipo, origem_id),
  constraint ck_instagram_marcacao_tipo check (tipo in ('story', 'post', 'reels', 'comentario')),
  constraint ck_instagram_marcacao_estado check (estado in ('sugerida', 'publicada', 'ignorada', 'agradecida', 'caso', 'sem_acao', 'falhou')),
  constraint ck_instagram_marcacao_clima check (ia_clima is null or ia_clima in ('positivo', 'neutro', 'negativo')),
  constraint ck_instagram_marcacao_resposta_por check (resposta_por is null or resposta_por in ('robo', 'padrao', 'equipe'))
);
-- A lista da tela (os últimos 30 dias, do mais novo ao mais velho, com o cursor data + id).
create index if not exists idx_instagram_marcacao_lista on instagram_marcacao (tenant_id, marcado_em desc, id desc);
alter table instagram_marcacao enable row level security;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'instagram_marcacao: tabela com RLS' as objeto,
       (select count(*) = 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'instagram_marcacao' and c.relrowsecurity) as ok
union all
select 'instagram_marcacao: uma marcação por origem (tenant_id, tipo, origem_id)',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname = 'uq_instagram_marcacao_origem' and k.contype = 'u')
union all
select 'instagram_marcacao: tipo, estado, clima e quem respondeu conferidos',
       (select count(*) = 4 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname in ('ck_instagram_marcacao_tipo', 'ck_instagram_marcacao_estado', 'ck_instagram_marcacao_clima', 'ck_instagram_marcacao_resposta_por'))
union all
select 'instagram_marcacao: criado_em por clock_timestamp()',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'instagram_marcacao' and column_name = 'criado_em'
           and is_nullable = 'NO' and column_default like 'clock_timestamp()%')
union all
select 'instagram_marcacao: índice da lista',
       (select count(*) = 1 from pg_indexes x
         where x.schemaname = current_schema() and x.tablename = 'instagram_marcacao' and x.indexname = 'idx_instagram_marcacao_lista')
union all
select 'instagram_conta: marcacao_story e marcacao_post nascem desligados',
       (select count(*) = 2 from information_schema.columns
         where table_schema = current_schema() and table_name = 'instagram_conta' and is_nullable = 'NO' and data_type = 'boolean'
           and column_name in ('marcacao_story', 'marcacao_post') and column_default = 'false');
