-- @cloud-only
-- 384 · OS COMENTÁRIOS DOS POSTS DO INSTAGRAM (F6 do atendente virtual, 09/11/2026 — protótipo
-- `mockups/regem-central-atendimento.html`). O aviso `comments` da Meta (Instagram API com o login do Instagram) chega na
-- nuvem; o robô (o mesmo fluxo do n8n) responde em público no post, a equipe responde, manda a resposta privada (o Direct)
-- ou esconde, pela tela. Só NUVEM, como a 377/378: o aviso chega lá e o acesso da conta mora lá (a loja não tem estas
-- tabelas; a tela do servidor da loja pede à nuvem).
--
-- O que entra:
--   instagram_comentario — um comentário de um post da loja (nunca o da própria loja). `id` = uuidDeChave da empresa e do
--     id do comentário (V42); único por empresa e comentário (o aviso repetido não entra de novo — V24). `pai_id` = o
--     comentário de cima quando é resposta (a conversa do comentário). `midia_*` = o post (o link e a legenda, lidos uma
--     vez da Meta; falha fica nula). `resposta_*` = a resposta PÚBLICA da loja no post (uma por comentário: do robô ou da
--     equipe — `resposta_por`). `privada_*` = a resposta PRIVADA (no Direct; uma por comentário, até 7 dias depois dele);
--     `privada_igsid` = o cliente no Direct (para a conversa seguir quando ele responder). `escondido_*` = escondido no
--     post. `chamado_id` = o caso que o robô abriu ("chamar atendente"). `robo_entregue_em` = entregue ao robô e esperando
--     a resposta dele (sem rotina de 2 min: a lista mostra "sem resposta"). `criado_em` = clock_timestamp() (ERR-379).
--   instagram_conta.comentarios_robo — "Robô responde nos comentários". Nasce DESLIGADO.
--   instagram_conta.comentarios_fila — o comentário em que o robô chama a equipe vira caso na fila. Nasce LIGADO.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. A tabela nova (com as FKs dela) PRIMEIRO e os
-- `alter` de `instagram_conta` por último (ERR-362); nenhuma FK nova para tabela que já existe (ERR-377). O
-- `lock_timeout` desiste em vez de enfileirar escrita atrás das tabelas.
set local lock_timeout = '5s';

create table if not exists instagram_comentario (
  id                 uuid primary key,
  tenant_id          uuid not null references empresa(id) on delete cascade,
  ig_user_id         text not null,                       -- a conta da loja (o histórico fica depois de desconectar)
  comentario_id      text not null,                       -- o id do comentário no Instagram
  pai_id             text,                                -- o comentário de cima, quando este é resposta
  midia_id           text not null,
  midia_tipo         text,                                -- FEED, REELS, AD… (media_product_type)
  midia_link         text,                                -- o permalink do post
  midia_legenda      text,
  autor_id           text,
  autor_usuario      text,                                -- o @, sem o @
  texto              text not null,
  comentado_em       timestamptz not null,
  resposta_id        text,                                -- o id da resposta pública no Instagram
  resposta_texto     text,
  resposta_por       text,
  respondido_por     uuid,                                -- o colaborador (a equipe)
  respondido_em      timestamptz,
  privada_texto      text,
  privada_em         timestamptz,
  privada_por        uuid,
  privada_igsid      text,
  escondido          boolean not null default false,
  escondido_em       timestamptz,
  escondido_por      uuid,
  chamado_id         uuid references atendimento_chamado(id) on delete set null,
  robo_entregue_em   timestamptz,
  erro               text,
  criado_em          timestamptz not null default clock_timestamp(),
  atualizado_em      timestamptz not null default clock_timestamp(),
  -- Único por empresa e comentário; o id do comentário PRIMEIRO no índice: a chave `cm:` do robô acha a conversa sem saber a
  -- empresa (o `on conflict (tenant_id, comentario_id)` acha o índice pelas colunas, em qualquer ordem).
  constraint uq_instagram_comentario unique (comentario_id, tenant_id),
  constraint ck_instagram_comentario_resposta_por check (resposta_por is null or resposta_por in ('robo', 'equipe'))
);
-- A lista da tela (os últimos 30 dias, do mais novo ao mais velho) e o "sem resposta" (a contagem e o filtro).
create index if not exists idx_instagram_comentario_lista on instagram_comentario (tenant_id, comentado_em desc, id desc);
create index if not exists idx_instagram_comentario_sem_resposta on instagram_comentario (tenant_id, comentado_em desc)
  where resposta_id is null and privada_igsid is null and not escondido;
-- A conversa do comentário (o de cima e as respostas — a chave `cm:` não sabe a empresa) e o limite do robô por hora.
create index if not exists idx_instagram_comentario_pai on instagram_comentario (pai_id) where pai_id is not null;
create index if not exists idx_instagram_comentario_robo on instagram_comentario (tenant_id, robo_entregue_em) where robo_entregue_em is not null;
alter table instagram_comentario enable row level security;

alter table instagram_conta add column if not exists comentarios_robo boolean not null default false;
alter table instagram_conta add column if not exists comentarios_fila boolean not null default true;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'instagram_comentario: tabela com RLS' as objeto,
       (select count(*) = 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'instagram_comentario' and c.relrowsecurity) as ok
union all
select 'instagram_comentario: único por empresa e comentário',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname = 'uq_instagram_comentario')
union all
select 'instagram_comentario: resposta_por é robo ou equipe',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname = 'ck_instagram_comentario_resposta_por')
union all
select 'instagram_comentario: criado_em por clock_timestamp()',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'instagram_comentario' and column_name = 'criado_em'
           and column_default like 'clock_timestamp()%')
union all
select 'índices da lista, do sem resposta, da conversa e do robô',
       (select count(*) = 4 from pg_indexes x
         where x.schemaname = current_schema()
           and x.indexname in ('idx_instagram_comentario_lista', 'idx_instagram_comentario_sem_resposta',
                               'idx_instagram_comentario_pai', 'idx_instagram_comentario_robo'))
union all
select 'instagram_conta: comentarios_robo (booleano, não nulo, padrão false)',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'instagram_conta' and column_name = 'comentarios_robo'
           and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'false')
union all
select 'instagram_conta: comentarios_fila (booleano, não nulo, padrão true)',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'instagram_conta' and column_name = 'comentarios_fila'
           and data_type = 'boolean' and is_nullable = 'NO' and column_default = 'true');
