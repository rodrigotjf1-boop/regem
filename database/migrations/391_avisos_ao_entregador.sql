-- @cloud-only
-- 391 · OS AVISOS AO ENTREGADOR (pedido do dono, 10/11/2026: "receber aviso quando o cliente do pedido que está na sua
-- rota estiver reclamando de demora ou perguntando pelo pedido; problemas depois da entrega — faltou bebida, troco,
-- item — o atendimento trata e, se entender, encaminha ao entregador; o entregador recebe a notificação e tem as
-- opções"). Só NUVEM, como a 199/201/388: o app do entregador fala com a nuvem; o servidor da loja pede à nuvem.
--
-- entregador_aviso — um aviso ao entregador de UM pedido:
--   origem 'robo'        — o cliente perguntou pelo pedido ou reclamou de demora (WhatsApp da loja nas duas vias, chat
--                          do iFood/99 pela ponte) com o pedido A CAMINHO; um aberto por pedido e motivo até o
--                          entregador responder (índice único parcial — duas mensagens, duas réplicas, um aviso só);
--   origem 'atendimento' — a equipe encaminhou pelo caso (chamado_id), com o motivo e o recado; também depois da entrega.
--   colaborador_id = o entregador do pedido na hora do aviso. visto_em / respondido_em / resposta = o que ele fez no
--   app (a caminho, cheguei, imprevisto, ligou, mandou mensagem…); resposta_saiu = se o aviso ao cliente saiu pelo
--   canal do pedido.
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Tabela nova e vazia; o `lock_timeout`
-- desiste em vez de enfileirar. A conferência no fim é pelo CATÁLOGO (ERR-425: o information_schema esconde a tabela do
-- papel de leitura).
set local lock_timeout = '5s';

create table if not exists entregador_aviso (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  pedido_id       uuid not null,
  colaborador_id  uuid not null,
  chamado_id      uuid,
  origem          text not null,
  motivo          text not null,
  texto           text,
  enviado_por     uuid,
  criado_em       timestamptz not null default clock_timestamp(),
  visto_em        timestamptz,
  respondido_em   timestamptz,
  resposta        text,
  resposta_saiu   boolean
);

do $$ begin
  alter table entregador_aviso add constraint ck_entregador_aviso_origem check (origem in ('robo', 'atendimento'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table entregador_aviso add constraint ck_entregador_aviso_motivo
    check (motivo in ('onde_esta', 'demora', 'faltou_item', 'faltou_troco', 'outro'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table entregador_aviso add constraint ck_entregador_aviso_resposta
    check (resposta is null or resposta in ('a_caminho', 'cheguei', 'imprevisto', 'ligou', 'mensagem', 'ok'));
exception when duplicate_object then null; end $$;

-- O automático: um aberto por pedido e motivo (a próxima pergunta do cliente, depois que o entregador respondeu, avisa de novo).
create unique index if not exists uq_entregador_aviso_robo_aberto
  on entregador_aviso (pedido_id, motivo) where origem = 'robo' and respondido_em is null;
-- O que o app pede a cada volta: os avisos abertos DELE.
create index if not exists idx_entregador_aviso_aberto
  on entregador_aviso (colaborador_id, criado_em desc) where respondido_em is null;
-- O caso do Atendimento mostra os avisos que mandou.
create index if not exists idx_entregador_aviso_chamado on entregador_aviso (chamado_id, criado_em desc) where chamado_id is not null;
create index if not exists idx_entregador_aviso_pedido on entregador_aviso (pedido_id, criado_em desc);

-- O que o cliente disse fica aqui: fora do alcance da API REST anônima do Supabase (RLS ligada e SEM política, como a
-- 342, a 366 e a 388 — o app usa um papel que atravessa a RLS).
alter table entregador_aviso enable row level security;

-- Conferência no MESMO Run: as quatro linhas têm de vir com `ok = true`.
select 'tabela entregador_aviso' as objeto,
       to_regclass(current_schema() || '.entregador_aviso') is not null as ok
union all
select 'regras de origem, motivo e resposta',
       (select count(*) = 3 from pg_constraint
         where conrelid = to_regclass(current_schema() || '.entregador_aviso')
           and conname in ('ck_entregador_aviso_origem', 'ck_entregador_aviso_motivo', 'ck_entregador_aviso_resposta'))
union all
select 'índice único do aviso automático aberto',
       exists (select 1 from pg_index i where i.indexrelid = to_regclass(current_schema() || '.uq_entregador_aviso_robo_aberto') and i.indisunique)
union all
select 'RLS ligada',
       coalesce((select c.relrowsecurity from pg_class c where c.oid = to_regclass(current_schema() || '.entregador_aviso')), false);
