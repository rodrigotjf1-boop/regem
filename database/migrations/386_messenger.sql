-- @cloud-only
-- 386 · O MESSENGER DO FACEBOOK (a última fase do atendente virtual, 09/11/2026 — protótipo
-- `mockups/regem-central-atendimento.html`). A loja conecta a PÁGINA do Facebook dela (o "Facebook Login" do app da
-- distribuição); as mensagens do Messenger entram na fila do Atendimento (casos) e/ou são respondidas pelo MESMO robô do
-- WhatsApp (o fluxo do n8n, chave `fb:`); a equipe responde pela tela. O espelho do Instagram Direct (377/378). Só NUVEM,
-- como a 377: o aviso da Meta chega na nuvem e o acesso da página mora lá, cifrado (a loja não tem estas tabelas; a tela do
-- servidor da loja pede à nuvem).
--
-- O que entra:
--   messenger_conta — a página CONECTADA (uma por empresa; uma página em uma empresa só). `pagina_id` = o id da página (vem
--     no `entry.id` do aviso). `token_cifrado` = o acesso da PÁGINA (o que a Meta dá a partir do acesso longo de quem
--     conectou — não vence), cifrado com a chave da distribuição (`common/cifra-segredo`); nunca sai na API.
--     `fila_ligada` = "Mensagens do Messenger na fila" (nasce LIGADA). `robo_responde` = "Robô responde no Messenger" (nasce
--     DESLIGADO). `cardapio_id` = o cardápio que o robô usa (vazio = o único da empresa; apagar o cardápio deixa vazio).
--     `erro`/`erro_em` = a última falha (o acesso que a Meta deixou de aceitar), sem segredo. Desconectar apaga a linha.
--   messenger_mensagem — as mensagens do Messenger (a Meta não guarda histórico para nós): as do cliente (entrada) e as da
--     loja (saída: a equipe e o robô pelo Regem; ou `loja` = quem respondeu pelo app do Facebook / Meta Business Suite, que
--     o aviso traz como eco). `mid` = o id da mensagem na Meta: o aviso repetido e o eco da própria resposta não entram duas
--     vezes. Guarda a página (`pagina_id`) em texto: o histórico fica depois de desconectar. `criado_em` =
--     clock_timestamp() (ERR-379: a mesma transação não empata a ordem).
--   messenger_contato — o nome do cliente (o perfil do Messenger: nome e sobrenome), lido da Meta na primeira mensagem.
--   messenger_escolha — a escolha da página quando quem conectou administra MAIS de uma: a lista `[{id, nome, token}]`
--     cifrada (os acessos das páginas), quem conectou, as permissões concedidas e até quando vale (15 min). Uma por empresa
--     (a nova substitui); escolher apaga.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Só tabelas novas (com as FKs delas); nenhuma
-- FK nova para tabela que já existe e nenhum `alter` em tabela existente (ERR-362/377). O `lock_timeout` desiste em vez de
-- enfileirar escrita atrás das tabelas.
set local lock_timeout = '5s';

create table if not exists messenger_conta (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  pagina_id          text not null,
  pagina_nome        text,
  token_cifrado      text not null,
  permissoes         text,
  fila_ligada        boolean not null default true,
  robo_responde      boolean not null default false,
  cardapio_id        uuid references cardapio_config(id) on delete set null,
  conectado_por      uuid,
  conectado_em       timestamptz not null default clock_timestamp(),
  erro               text,
  erro_em            timestamptz,
  atualizado_em      timestamptz not null default clock_timestamp(),
  constraint uq_messenger_conta_empresa unique (tenant_id),
  constraint uq_messenger_conta_pagina unique (pagina_id)
);
alter table messenger_conta enable row level security;

create table if not exists messenger_mensagem (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  pagina_id          text not null,                       -- a página da loja
  psid               text not null,                       -- o cliente (o id dele no Messenger, para esta página)
  direcao            text not null,
  autor              text not null,
  tipo               text not null default 'texto',
  texto              text,
  midia_url          text,
  mid                text,
  chamado_id         uuid references atendimento_chamado(id) on delete set null,
  autor_id           uuid,
  estado             text not null default 'recebida',
  erro               text,
  criado_em          timestamptz not null default clock_timestamp(),
  constraint ck_messenger_msg_direcao check (direcao in ('entrada', 'saida')),
  constraint ck_messenger_msg_autor check (autor in ('cliente', 'equipe', 'loja', 'robo')),
  constraint ck_messenger_msg_estado check (estado in ('recebida', 'enviada', 'falhou'))
);
create unique index if not exists uq_messenger_msg_mid on messenger_mensagem (tenant_id, mid) where mid is not null;
-- A conversa de um cliente (o caso, o robô, "Conversas agora") e a rotina "sem resposta" (as últimas 30 min da empresa).
create index if not exists idx_messenger_msg_conversa on messenger_mensagem (tenant_id, psid, criado_em desc);
create index if not exists idx_messenger_msg_empresa_hora on messenger_mensagem (tenant_id, criado_em desc);
alter table messenger_mensagem enable row level security;

create table if not exists messenger_contato (
  tenant_id          uuid not null references empresa(id) on delete cascade,
  psid               text not null,
  nome               text,
  atualizado_em      timestamptz not null default clock_timestamp(),
  primary key (tenant_id, psid)
);
alter table messenger_contato enable row level security;

create table if not exists messenger_escolha (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  colaborador_id     uuid,
  paginas_cifradas   text not null,
  permissoes         text,
  vence_em           timestamptz not null,
  criado_em          timestamptz not null default clock_timestamp(),
  constraint uq_messenger_escolha_empresa unique (tenant_id)
);
alter table messenger_escolha enable row level security;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'tabelas com RLS (conta, mensagem, contato, escolha)' as objeto,
       (select count(*) = 4 from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relrowsecurity
           and c.relname in ('messenger_conta', 'messenger_mensagem', 'messenger_contato', 'messenger_escolha')) as ok
union all
select 'messenger_conta: uma por empresa e uma página em uma empresa só',
       (select count(*) = 2 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname in ('uq_messenger_conta_empresa', 'uq_messenger_conta_pagina'))
union all
select 'messenger_conta: fila nasce ligada e o robô desligado',
       (select count(*) = 2 from information_schema.columns
         where table_schema = current_schema() and table_name = 'messenger_conta' and is_nullable = 'NO' and data_type = 'boolean'
           and ((column_name = 'fila_ligada' and column_default = 'true') or (column_name = 'robo_responde' and column_default = 'false')))
union all
select 'messenger_mensagem: autor, direção e estado conferidos',
       (select count(*) = 3 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname in ('ck_messenger_msg_direcao', 'ck_messenger_msg_autor', 'ck_messenger_msg_estado'))
union all
select 'messenger_mensagem: criado_em por clock_timestamp()',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'messenger_mensagem' and column_name = 'criado_em'
           and is_nullable = 'NO' and column_default like 'clock_timestamp()%')
union all
select 'índices do mid, da conversa e da hora',
       (select count(*) = 3 from pg_indexes x
         where x.schemaname = current_schema()
           and x.indexname in ('uq_messenger_msg_mid', 'idx_messenger_msg_conversa', 'idx_messenger_msg_empresa_hora'))
union all
select 'messenger_escolha: uma por empresa',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname = 'uq_messenger_escolha_empresa');
