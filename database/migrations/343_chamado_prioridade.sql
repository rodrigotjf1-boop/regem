-- 343_chamado_prioridade.sql — o chamado de atendimento ganha PRIORIDADE (cliente irritado → urgente).
--
-- ⚠️ NÃO é @cloud-only: `atendimento_chamado` existe na nuvem e no servidor da loja e sincroniza nos dois sentidos
--    (sync-config: direcao 'ambos'). O sync lê as colunas de cada lado: enquanto a loja não recebe esta migration (vem
--    no .zip), a coluna que a nuvem manda a mais é ignorada lá — o chamado chega, só sem o destaque de urgente.
-- ⚠️ Vai pelo MCP do Supabase: sem instrução destrutiva (V9, ERR-225). Idempotente.
--
-- Pedido do dono (30/10/2026): cliente estressado → o robô acolhe, não tenta resolver, diz que a equipe vai analisar e
-- alerta a equipe com URGÊNCIA (quando houver fila de atendimento, esse chamado vai na frente). `prioridade`:
-- 'normal' (tudo o que já existia) | 'urgente'. As linhas antigas ficam 'normal' pelo default (coluna com default
-- constante: o Postgres não reescreve a tabela).
set local lock_timeout = '5s';

alter table atendimento_chamado add column if not exists prioridade text not null default 'normal';

do $$
begin
  if not exists (
    select 1
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where c.conname = 'ck_atendimento_chamado_prioridade'
       and t.relname = 'atendimento_chamado'
       and n.nspname = current_schema()
  ) then
    alter table atendimento_chamado
      add constraint ck_atendimento_chamado_prioridade check (prioridade in ('normal', 'urgente'));
  end if;
end $$;
