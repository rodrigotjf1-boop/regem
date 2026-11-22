-- @cloud-only
-- 488 · O AVISO DO PERFIL DO CLIENTE (`docs/plano-perfil-cliente.md`, decisão do dono de 22/11/2026: o perfil só abre depois de
-- o cliente ser avisado; CDC art. 43 §2º, LGPD arts. 9º e 10 §2º). Só NUVEM (SO_NUVEM no sync-daemon).
--
-- cliente_aviso_perfil — a prova de que o aviso apareceu para quem provou ser o dono do telefone (o código do WhatsApp): a
--   versão e o texto mostrados, a resposta ("continuou" ou "recusou"), de onde veio e quando. Só inclusão; uma linha por
--   cliente e versão. Quem recusou também tem o "não quero ser analisado" em `cliente_escolha`, que é a escolha que vale.
--
-- A tabela sozinha não muda nada: a regra só vale com a variável `PERFIL_SO_COM_AVISO=1` na API.
-- `clock_timestamp()` no carimbo (V9, ERR-379). RLS ligada e SEM política. Sem instrução destrutiva (MCP: V9, ERR-225).
-- Idempotente.
set local lock_timeout = '5s';

create table if not exists cliente_aviso_perfil (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  cliente_id  uuid not null references cliente(id) on delete cascade,
  versao      text not null,
  texto       text not null,
  resposta    text not null,
  origem      text not null,
  em          timestamptz not null default clock_timestamp()
);
do $$ begin
  alter table cliente_aviso_perfil add constraint ck_cliente_aviso_perfil_resposta check (resposta in ('continuou', 'recusou'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table cliente_aviso_perfil add constraint ck_cliente_aviso_perfil_origem check (origem in
    ('cardapio_entrada', 'cardapio_perfil', 'cardapio_pedido', 'whatsapp'));
exception when duplicate_object then null; end $$;
create unique index if not exists uq_cliente_aviso_perfil on cliente_aviso_perfil (cliente_id, versao);
alter table cliente_aviso_perfil enable row level security;

-- Conferência (no mesmo Run).
select to_regclass('cliente_aviso_perfil') is not null
   and (select count(*) from pg_constraint where conrelid = to_regclass('cliente_aviso_perfil')
         and conname in ('ck_cliente_aviso_perfil_resposta', 'ck_cliente_aviso_perfil_origem')) = 2
   and to_regclass('uq_cliente_aviso_perfil') is not null as ok;
