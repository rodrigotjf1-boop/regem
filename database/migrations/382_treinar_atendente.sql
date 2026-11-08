-- @cloud-only
-- 382 · TREINAR O ATENDENTE (F4 do atendente virtual, 08/11/2026 — pedido do dono: "mais treinamento do nosso atendente
-- virtual"; protótipo `mockups/regem-central-atendimento.html`). Só NUVEM: o robô (o fluxo do n8n), as instruções e as
-- conversas moram lá (no servidor da loja não há robô — V1).
--
-- atendente_teste — a conversa de TESTE: o gerente escreve como se fosse um cliente e a mensagem vai ao MESMO robô de
--   verdade com a chave `teste:<id>` (na instância e no `de`, o truque do Direct — nada muda no n8n). Nada sai para cliente
--   nenhum e nada de verdade é criado: chamar a equipe, recado e pedido viram SIMULAÇÃO (uma linha 'sistema').
--   `canal` = as instruções e o perfil de qual canal ('whatsapp' ou 'direct'); `fora_do_horario` = "simular fora do
--   horário" (o perfil e o recado de quando a equipe não está); `cardapio_id` = o cardápio que o robô consulta (escolhido ao
--   criar: o do número do WhatsApp ou o do Instagram; sem FK — o cardápio apagado só faz o teste recusar a mensagem);
--   `usuario_id` = quem abriu (o colaborador; o limite de mensagens por minuto é por ele). Ao criar um teste, os da mesma
--   empresa parados há mais de 7 dias são apagados (as mensagens vão junto, em cascata).
-- atendente_teste_msg — as mensagens da conversa de teste: a do "cliente" (o gerente), a do robô (texto e as opções que ele
--   mandou) e a do sistema (o que aconteceria na conversa de verdade: `simulado` = { tipo, detalhe, … }).
--   `criado_em` = clock_timestamp() (ERR-379: a pergunta e a resposta não empatam a ordem).
-- atendente_conhecimento — o que a loja ENSINOU: pergunta → resposta, por assunto (uma linha por item: duas pessoas
--   editando itens diferentes não se atropelam — nada de jsonb com dois escritores, V82). Entra nas instruções do robô de
--   todos os canais. `origem` = de onde veio a correção ('teste', 'caso' da Central ou 'manual'). O limite (100 por empresa)
--   e o tamanho dos textos são regra do código (`cardapio/conhecimento-do-atendente.ts`); aqui, a forma.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Nenhuma FK nova para `empresa` (ERR-362/377):
-- a limpeza é por empresa no código. O `lock_timeout` desiste em vez de enfileirar escrita atrás de uma tabela.
set local lock_timeout = '5s';

create table if not exists atendente_teste (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  usuario_id       uuid,
  canal            text not null,
  fora_do_horario  boolean not null default false,
  cardapio_id      uuid,
  criado_em        timestamptz not null default clock_timestamp(),
  atualizado_em    timestamptz not null default clock_timestamp(),
  constraint ck_atendente_teste_canal check (canal in ('whatsapp', 'direct'))
);
create index if not exists idx_atendente_teste_empresa on atendente_teste (tenant_id, criado_em desc);
alter table atendente_teste enable row level security;

create table if not exists atendente_teste_msg (
  id          uuid primary key default gen_random_uuid(),
  teste_id    uuid not null references atendente_teste(id) on delete cascade,
  tenant_id   uuid not null,
  autor       text not null,
  texto       text not null,
  opcoes      jsonb,
  simulado    jsonb,
  criado_em   timestamptz not null default clock_timestamp(),
  constraint ck_atendente_teste_msg_autor check (autor in ('cliente', 'robo', 'sistema'))
);
create index if not exists idx_atendente_teste_msg_conversa on atendente_teste_msg (teste_id, criado_em);
alter table atendente_teste_msg enable row level security;

create table if not exists atendente_conhecimento (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null,
  assunto          text not null,
  pergunta         text not null,
  resposta         text not null,
  origem           text not null,
  criado_por       uuid,
  criado_por_nome  text,
  criado_em        timestamptz not null default clock_timestamp(),
  atualizado_em    timestamptz not null default clock_timestamp(),
  constraint ck_atendente_conhecimento_assunto check (assunto in ('entrega', 'pagamento', 'cardapio', 'horario', 'pedido', 'outro')),
  constraint ck_atendente_conhecimento_origem check (origem in ('teste', 'caso', 'manual'))
);
create index if not exists idx_atendente_conhecimento_empresa on atendente_conhecimento (tenant_id, assunto, criado_em);
alter table atendente_conhecimento enable row level security;

-- Conferência no MESMO Run: as linhas têm de vir com `ok = true`.
select 'tabela ' || t.nome || ' (com RLS)' as objeto,
       (select coalesce(bool_and(c.relrowsecurity), false) and count(*) = 1
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = t.nome and c.relkind = 'r') as ok
  from (values ('atendente_teste'), ('atendente_teste_msg'), ('atendente_conhecimento')) as t(nome)
union all
select 'índice ' || i.nome,
       (select count(*) = 1 from pg_indexes x where x.schemaname = current_schema() and x.indexname = i.nome)
  from (values ('idx_atendente_teste_empresa'), ('idx_atendente_teste_msg_conversa'), ('idx_atendente_conhecimento_empresa')) as i(nome)
union all
select 'regra ' || r.nome,
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and k.conname = r.nome)
  from (values ('ck_atendente_teste_canal'), ('ck_atendente_teste_msg_autor'), ('ck_atendente_conhecimento_assunto'),
               ('ck_atendente_conhecimento_origem')) as r(nome)
union all
select 'atendente_teste_msg.criado_em = clock_timestamp() (ERR-379)',
       (select count(*) = 1 from information_schema.columns
         where table_schema = current_schema() and table_name = 'atendente_teste_msg'
           and column_name = 'criado_em' and column_default like 'clock_timestamp()%')
union all
select 'mensagens apagadas junto com o teste (cascata)',
       (select count(*) = 1 from pg_constraint k join pg_class c on c.oid = k.conrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'atendente_teste_msg' and k.contype = 'f' and k.confdeltype = 'c');
