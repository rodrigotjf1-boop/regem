-- 181_config_sync_updated_at.sql — habilita o SYNC ESPELHADO das CONFIGS:
-- `equipamento` (impressoras/terminais) e `delivery_config` (cupom/perfis) passam a
-- sincronizar cloud↔edge (cursor updated_at, LWW). Aqui só o gatilho de updated_at;
-- as direções ficam no sync-config (equipamento é FILTRADO p/ impressora/pdv/salao,
-- nunca servidor_local — segurança).
--
-- NÃO é @cloud-only: as duas tabelas existem no edge; o sync roda dos dois lados.

alter table equipamento add column if not exists updated_at timestamptz not null default now();

-- reusa a função bump_updated_at() (mig 095)
do $$
declare t text;
begin
  foreach t in array array['equipamento','delivery_config'] loop
    execute format('drop trigger if exists trg_bump_updated_at on %I', t);
    execute format('create trigger trg_bump_updated_at before update on %I '
                   || 'for each row execute function bump_updated_at()', t);
  end loop;
end $$;
