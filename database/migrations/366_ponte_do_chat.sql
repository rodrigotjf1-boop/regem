-- @cloud-only
-- 366 · A PONTE DO CHAT do iFood e da 99 (decisão do dono, 04/11/2026: "vamos usar o caminho não oficial"; protótipos
-- `mockups/regem-central-atendimento.html` v3 e a peça 6 de `mockups/regem-conexao-servidor.html`, aprovados em 04/11).
-- Só NUVEM: o programa da ponte, no PC da loja, fala com a nuvem; a fila, o robô e os ajustes moram lá.
--
-- O que entra:
--   chat_ponte — o programa da ponte em cada PC: um `equipamento` do tipo 'ponte_chat' (pareado e revogado só na nuvem,
--     como o celular do app de atendimento da 353). Guarda em quais plataformas ele está logado, quando deu sinal, a
--     versão, o nome do PC e o papel pedido (automático, principal ou reserva). A 99 aceita um login só (ERR-365): quem
--     manda nela é a ponte que estiver logada.
--   chat_plataforma_msg — as mensagens do chat do iFood e da 99: as do cliente (entrada, que a ponte traz) e as da loja
--     (saída: aviso automático, robô, equipe). A SAÍDA é uma fila: a ponte que responde pelo canal pega a vez, digita no
--     chat da plataforma e devolve o resultado (prazo de 90 s; até 3 tentativas). A mesma mensagem da plataforma entra
--     uma vez só (canal + id dela); cada aviso automático sai uma vez só por pedido ("saiu", "chegando", "obrigado").
--   robo_config.chat_* — os ajustes (Delivery › Configurações › Atendimento › "iFood e 99 · chat pela ponte"): a ponte
--     nasce DESLIGADA; os avisos "saiu" e "chegando" nascem ligados (só valem com a ponte ligada); o "obrigado" e o robô
--     no chat nascem desligados; texto vazio = o texto padrão do Regem.
--
-- Ordem (ERR-362): primeiro as tabelas com chave para `empresa`/`equipamento`; os `alter` de robo_config por último.
-- Sem instrução destrutiva (V9, ERR-225). Idempotente. Tabelas novas e pequenas; o `lock_timeout` desiste em vez de
-- enfileirar escrita atrás de robo_config.
set local lock_timeout = '5s';

create table if not exists chat_ponte (
  equipamento_id uuid primary key references equipamento(id) on delete cascade,
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid,
  -- {"ifood": {"logado": true}, "99food": {"logado": false}} — o que a ponte informou no último sinal.
  plataformas    jsonb not null default '{}'::jsonb,
  papel          text not null default 'auto',
  versao         text,
  maquina        text,
  visto_em       timestamptz,
  atualizado_em  timestamptz not null default now()
);
do $$ begin
  alter table chat_ponte add constraint ck_chat_ponte_papel check (papel in ('auto', 'principal', 'reserva'));
exception when duplicate_object then null; end $$;
create index if not exists idx_chat_ponte_loja on chat_ponte (tenant_id, unidade_id);

create table if not exists chat_plataforma_msg (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid,
  canal          text not null,
  pedido_id      uuid,
  pedido_externo text,
  pedido_numero  text,
  cliente_nome   text,
  direcao        text not null,
  autor          text not null,
  autor_id       uuid,
  motivo         text,
  texto          text not null,
  externo_msg_id text,
  estado         text not null,
  erro           text,
  ponte_id       uuid,
  tentativas     integer not null default 0,
  vence_em       timestamptz,
  criado_em      timestamptz not null default now(),
  enviado_em     timestamptz
);
do $$ begin
  alter table chat_plataforma_msg add constraint ck_chat_msg_canal check (canal in ('ifood', '99food'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table chat_plataforma_msg add constraint ck_chat_msg_direcao check (direcao in ('entrada', 'saida'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table chat_plataforma_msg add constraint ck_chat_msg_autor check (autor in ('cliente', 'loja', 'robo', 'equipe', 'aviso'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table chat_plataforma_msg add constraint ck_chat_msg_estado
    check (estado in ('recebida', 'pendente', 'enviando', 'enviada', 'falhou', 'cancelada'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table chat_plataforma_msg add constraint ck_chat_msg_motivo check (motivo is null or motivo in ('saiu', 'chegando', 'obrigado'));
exception when duplicate_object then null; end $$;

-- A mesma mensagem da plataforma entra uma vez só (a ponte reenvia o que não teve resposta; duas pontes leem o mesmo chat).
create unique index if not exists uq_chat_msg_da_plataforma
  on chat_plataforma_msg (tenant_id, canal, externo_msg_id) where externo_msg_id is not null;
-- Cada aviso automático sai uma vez só por pedido (a rotina e duas réplicas não mandam dois "saiu").
create unique index if not exists uq_chat_aviso_por_pedido
  on chat_plataforma_msg (pedido_id, motivo) where motivo is not null;
-- A fila de saída que a ponte pega (só o que ainda falta mandar — índice parcial pequeno).
create index if not exists idx_chat_msg_fila_saida
  on chat_plataforma_msg (tenant_id, canal, criado_em) where direcao = 'saida' and estado in ('pendente', 'enviando');
-- A conversa de um pedido (o caso da tela Atendimento).
create index if not exists idx_chat_msg_pedido on chat_plataforma_msg (pedido_id, criado_em) where pedido_id is not null;
create index if not exists idx_chat_msg_loja on chat_plataforma_msg (tenant_id, unidade_id, criado_em desc);

-- Nome do cliente e o que ele escreveu: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como
-- a 342, a 344 e a 353 (o app usa um papel que atravessa a RLS).
alter table chat_ponte enable row level security;
alter table chat_plataforma_msg enable row level security;

alter table robo_config add column if not exists chat_ponte_ligada boolean not null default false;
alter table robo_config add column if not exists chat_robo_responde boolean not null default false;
alter table robo_config add column if not exists chat_aviso_saiu boolean not null default true;
alter table robo_config add column if not exists chat_aviso_saiu_texto text;
alter table robo_config add column if not exists chat_aviso_chegando boolean not null default true;
alter table robo_config add column if not exists chat_aviso_chegando_texto text;
alter table robo_config add column if not exists chat_aviso_obrigado boolean not null default false;
alter table robo_config add column if not exists chat_aviso_obrigado_texto text;

-- Conferência no MESMO Run: as seis linhas têm de vir com `ok = true`.
select 'tabela chat_ponte' as objeto,
       to_regclass(current_schema() || '.chat_ponte') is not null as ok
union all
select 'tabela chat_plataforma_msg',
       to_regclass(current_schema() || '.chat_plataforma_msg') is not null
union all
select 'RLS ligada nas duas',
       coalesce((select bool_and(c.relrowsecurity) from pg_class c
                  where c.oid in (to_regclass(current_schema() || '.chat_ponte'),
                                  to_regclass(current_schema() || '.chat_plataforma_msg'))), false)
union all
select 'índices únicos (mensagem da plataforma, aviso por pedido)',
       (select count(*) = 2 from pg_indexes
         where schemaname = current_schema() and indexname in ('uq_chat_msg_da_plataforma', 'uq_chat_aviso_por_pedido'))
union all
select 'regras de canal, direção, autor, estado, motivo e papel',
       (select count(*) = 6 from pg_constraint
         where conname in ('ck_chat_msg_canal', 'ck_chat_msg_direcao', 'ck_chat_msg_autor', 'ck_chat_msg_estado',
                           'ck_chat_msg_motivo', 'ck_chat_ponte_papel'))
union all
select 'robo_config.chat_* (8 colunas)',
       (select count(*) = 8 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config'
           and column_name in ('chat_ponte_ligada', 'chat_robo_responde', 'chat_aviso_saiu', 'chat_aviso_saiu_texto',
                               'chat_aviso_chegando', 'chat_aviso_chegando_texto', 'chat_aviso_obrigado',
                               'chat_aviso_obrigado_texto'));
