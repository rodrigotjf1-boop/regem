-- @cloud-only
-- 481 · "VIU E NÃO PEDIU" NA CONVERSA (F7 parte 4d do `docs/plano-perfil-cliente.md`, §6.3 — aprovada pelo dono em 19/11/2026;
-- protótipo `mockups/regem-perfil-cliente.html`, aba "Marketing", "Automáticas novas": "Viu e não pediu — lembrete leve na
-- próxima conversa que o cliente abrir. Só para quem ligou as recomendações. Desligada"). Só NUVEM (SO_NUVEM no sync-daemon).
--
-- relacionamento_config.viu_ativo — ligado (Delivery › Marketing › Automáticas), o atendente virtual recebe no cartão do
--   cliente o produto que ele abriu 2 vezes ou mais no cardápio e não pediu (a régua de `common/interesse-do-cliente.ts`),
--   para sugerir UMA vez se combinar com a conversa — sem custo de modelo (é a conversa que o próprio cliente abriu). Nasce
--   DESLIGADO.
-- cliente_lembrete_viu — o freio: quando o lembrete foi entregue ao atendente, para quem e de qual produto. No máximo um a
--   cada N dias por cliente (o "uma oferta a cada N dias" das Automáticas); nas 6 horas seguintes (a mesma conversa) o mesmo
--   produto continua no cartão.
--
-- `clock_timestamp()` no carimbo (V9, ERR-379). RLS ligada e SEM política. Sem instrução destrutiva (MCP: V9, ERR-225).
-- Idempotente.
set local lock_timeout = '5s';

alter table relacionamento_config add column if not exists viu_ativo boolean not null default false;

create table if not exists cliente_lembrete_viu (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  cliente_id  uuid not null references cliente(id) on delete cascade,
  produto_id  uuid not null,
  em          timestamptz not null default clock_timestamp()
);
create index if not exists ix_cliente_lembrete_viu on cliente_lembrete_viu (tenant_id, cliente_id, em desc);
alter table cliente_lembrete_viu enable row level security;

-- Conferência (no mesmo Run).
select (select count(*) from information_schema.columns where table_schema = current_schema()
          and table_name = 'relacionamento_config' and column_name = 'viu_ativo') = 1
   and to_regclass('cliente_lembrete_viu') is not null as ok;
