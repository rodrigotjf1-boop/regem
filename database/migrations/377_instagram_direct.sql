-- @cloud-only
-- 377 · INSTAGRAM DIRECT NA FILA (item 6 do checkpoint da Central de atendimento, 06/11/2026; protótipo
-- `mockups/regem-central-atendimento.html`, versão 7: o grupo de ajustes "Instagram Direct" e o caso do Direct). Caminho
-- oficial: Instagram API com o login do Instagram (Business Login for Instagram, conferido em 06/11/2026). A loja entra
-- com a conta PROFISSIONAL e autoriza; o app, o segredo, o aviso de mensagem e a renovação do acesso são da distribuição.
-- Só NUVEM, como a 366/375: o aviso do Instagram chega na nuvem e o acesso mora nela (a loja não tem estas tabelas).
--
-- instagram_conta — a conta do Instagram CONECTADA (uma por empresa; uma conta do Instagram em uma empresa só).
--   `ig_user_id` = o id da conta profissional (vem no `entry.id` do aviso). `token_cifrado` = o acesso, cifrado com a
--   chave da distribuição (`common/cifra-segredo`); vale 60 dias e o Regem renova sozinho (`token_renovado_em`). Nunca
--   sai na API. `fila_ligada` = "Mensagens do Direct na fila". `erro`/`erro_em` = a última falha (renovar, assinar os
--   avisos), sem segredo. Desconectar apaga a linha (o acesso some junto).
-- instagram_mensagem — as mensagens do Direct (a Meta não guarda histórico): as do cliente (entrada) e as da loja
--   (saída: a equipe pelo Regem; ou `loja` = quem respondeu no próprio app do Instagram, que o aviso traz como eco).
--   `mid` = o id da mensagem no Instagram: o aviso repetido (a Meta reentrega por até 36 h) e o eco da própria resposta
--   não entram duas vezes. Guarda a conta (`ig_user_id`) em texto: o histórico fica mesmo depois de desconectar.
--   `criado_em` = clock_timestamp() (ERR-379: a mesma transação não empata a ordem).
-- instagram_contato — o perfil do cliente (nome, @, se segue a loja), lido da Meta na primeira mensagem.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

create table if not exists instagram_conta (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  ig_user_id         text not null,
  usuario            text,                                -- o @, sem o @
  nome               text,
  token_cifrado      text not null,
  token_vence_em     timestamptz,
  token_renovado_em  timestamptz not null default clock_timestamp(),
  permissoes         text,
  fila_ligada        boolean not null default true,
  conectado_por      uuid,
  conectado_em       timestamptz not null default clock_timestamp(),
  erro               text,
  erro_em            timestamptz,
  atualizado_em      timestamptz not null default clock_timestamp(),
  constraint uq_instagram_conta_empresa unique (tenant_id),
  constraint uq_instagram_conta_ig unique (ig_user_id)
);
alter table instagram_conta enable row level security;

create table if not exists instagram_mensagem (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  ig_user_id         text not null,                       -- a conta da loja
  igsid              text not null,                       -- o cliente (o id dele no Instagram, neste app)
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
  constraint ck_instagram_msg_direcao check (direcao in ('entrada', 'saida')),
  constraint ck_instagram_msg_autor check (autor in ('cliente', 'equipe', 'loja', 'robo')),
  constraint ck_instagram_msg_estado check (estado in ('recebida', 'enviada', 'falhou', 'apagada'))
);
create unique index if not exists uq_instagram_msg_mid on instagram_mensagem (tenant_id, mid) where mid is not null;
-- A conversa de um cliente (o caso) e o placar do período (Números do atendimento).
create index if not exists idx_instagram_msg_conversa on instagram_mensagem (tenant_id, igsid, criado_em desc);
create index if not exists idx_instagram_msg_empresa_hora on instagram_mensagem (tenant_id, criado_em desc);
alter table instagram_mensagem enable row level security;

create table if not exists instagram_contato (
  tenant_id          uuid not null references empresa(id) on delete cascade,
  igsid              text not null,
  usuario            text,
  nome               text,
  segue_a_loja       boolean,
  atualizado_em      timestamptz not null default clock_timestamp(),
  primary key (tenant_id, igsid)
);
alter table instagram_contato enable row level security;

-- Conferência (no mesmo Run): as tabelas (com RLS) e os índices.
select 'tabela' as o_que, c.relname as nome, c.relrowsecurity::text as ok
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = current_schema() and c.relname in ('instagram_conta', 'instagram_mensagem', 'instagram_contato')
union all
select 'indice', i.indexname, 'true'
  from pg_indexes i
 where i.schemaname = current_schema()
   and i.indexname in ('uq_instagram_msg_mid', 'idx_instagram_msg_conversa', 'idx_instagram_msg_empresa_hora')
 order by 1, 2;
