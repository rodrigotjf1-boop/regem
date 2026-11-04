-- @cloud-only
-- 365 · PEDIR AVALIAÇÃO NO GOOGLE DEPOIS DA ENTREGA (pedido do dono, 04/11/2026; desenho aprovado no mesmo dia: "aprovado o
-- recomendado com um adicional — quando o pedido é do iFood, o pedido de avaliação é na plataforma do iFood"). Só NUVEM,
-- como a 352 ("Chegou tudo certo?"): o robô e o WhatsApp só existem lá; a loja não tem a tabela nova (SO_NUVEM no
-- sync-daemon).
--
-- O que entra:
--   robo_config.avaliacao_* — os ajustes da loja (NASCE DESLIGADO): o link "Pedir avaliações" do Perfil da Empresa no
--     Google, a mensagem (com {nome} e {link}), quantos minutos depois da entrega, "só pedidos sem problema" (o padrão do
--     dono) ou todos, a partir de qual pedido do cliente (o cliente recorrente) e depois de quantos dias pedir de novo a
--     quem não tocou no link. A regra mora no serviço (`whatsapp/pedir-avaliacao.ts`): sem CHECK aqui.
--   avaliacao_pedida — UMA linha por pedido: mandou ("enviado"), decidiu não mandar ("nao_enviado", com o motivo) ou a
--     Meta recusou ("falhou"); o link que foi na mensagem e o toque nele (`tocou_em`). A rotina grava ANTES de mandar
--     (`insert … on conflict do nothing returning`): duas réplicas da API, ou duas voltas, nunca mandam duas vezes (V24,
--     V42). Fica numa tabela PRÓPRIA, e não no registro dos envios do pedido (`pedido_envio`), porque aquele se apaga com
--     90 dias — e "quem já tocou no link não recebe" e "pedir de novo depois de 180 dias" precisam lembrar mais que isso.
--     A chave do telefone (`chaveTelefone`) vai na linha: "já tocou?" e "recebeu nos últimos N dias?" são uma busca pelo
--     índice, sem calcular a chave do histórico da loja a cada pedido (ERR-353, LIC-113). Pedido do iFood e da 99 nunca
--     entra: a avaliação é pedida pela própria plataforma.
--   idx_atendimento_chamado_pedido — "o pedido teve caso de problema ou cancelamento?" pelo índice (antes, todos os casos
--     da empresa a cada pedido).
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. `add column` com valor padrão constante não
-- reescreve a tabela (pequena); o `lock_timeout` desiste em vez de enfileirar escrita atrás dela. A tabela de casos é
-- pequena na nuvem (04/11: 19 linhas): o índice sobe na hora.
set local lock_timeout = '5s';

alter table robo_config add column if not exists avaliacao_ativa boolean not null default false;
alter table robo_config add column if not exists avaliacao_link text;
alter table robo_config add column if not exists avaliacao_texto text;
alter table robo_config add column if not exists avaliacao_depois_min integer not null default 40;
alter table robo_config add column if not exists avaliacao_so_sem_problema boolean not null default true;
alter table robo_config add column if not exists avaliacao_a_partir_do integer not null default 2;
alter table robo_config add column if not exists avaliacao_de_novo_dias integer not null default 60;

create table if not exists avaliacao_pedida (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid,
  pedido_id      uuid not null,
  chave_telefone text not null,
  resultado      text not null,
  motivo         text,
  link           text,
  dia            date not null,
  criado_em      timestamptz not null default now(),
  tocou_em       timestamptz
);
do $$ begin
  alter table avaliacao_pedida add constraint ck_avaliacao_pedida_resultado check (resultado in ('enviado', 'nao_enviado', 'falhou'));
exception when duplicate_object then null; end $$;
create unique index if not exists uq_avaliacao_pedida_pedido on avaliacao_pedida (pedido_id);
-- No máximo UM pedido de avaliação por cliente por dia (o dia da operação, que o serviço informa — V46): dois pedidos do
-- mesmo cliente na mesma volta, ou duas réplicas cada uma com um, nunca mandam dois. "Falhou" sai do índice.
create unique index if not exists uq_avaliacao_pedida_um_por_dia on avaliacao_pedida (tenant_id, chave_telefone, dia)
  where resultado = 'enviado';
create index if not exists idx_avaliacao_pedida_cliente on avaliacao_pedida (tenant_id, chave_telefone, criado_em desc);
create index if not exists idx_avaliacao_pedida_mes on avaliacao_pedida (tenant_id, criado_em desc);

-- Telefone e quem recebeu: fora do alcance da API REST anônima do Supabase. RLS ligada e SEM política, como a 342/356 (o
-- servidor usa um papel que atravessa a RLS).
alter table avaliacao_pedida enable row level security;

create index if not exists idx_atendimento_chamado_pedido
  on atendimento_chamado (pedido_id)
  where pedido_id is not null;

-- Conferência no MESMO Run: as seis linhas têm de vir com `ok = true`.
select 'ajustes da avaliação em robo_config (7 colunas)' as objeto,
       (select count(*) = 7 from information_schema.columns
         where table_schema = current_schema() and table_name = 'robo_config' and column_name like 'avaliacao\_%') as ok
union all
select 'tabela avaliacao_pedida',
       to_regclass(current_schema() || '.avaliacao_pedida') is not null
union all
select 'um pedido de avaliação por pedido (índice único)',
       to_regclass(current_schema() || '.uq_avaliacao_pedida_pedido') is not null
union all
select 'um por cliente por dia (índice único)',
       to_regclass(current_schema() || '.uq_avaliacao_pedida_um_por_dia') is not null
union all
select 'busca do cliente pelo índice',
       to_regclass(current_schema() || '.idx_avaliacao_pedida_cliente') is not null
union all
select 'casos do pedido pelo índice',
       to_regclass(current_schema() || '.idx_atendimento_chamado_pedido') is not null;
