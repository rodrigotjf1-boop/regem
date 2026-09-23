-- 283 — A tabela de inutilização entra no SINCRONISMO (gatilhos da mig 272/264).
--
-- ⚠️ NÃO é @cloud-only: a loja emite as próprias notas, deixa as próprias lacunas e pede a
--    própria inutilização. O comprovante precisa subir para a nuvem como a nota sobe.
-- ⚠️ Aplicar ANTES do merge. Idempotente (roda de novo sem efeito).
-- Depende da 282 (a tabela) e das funções `marcar_mudanca_sync` (mig 264), `bump_updated_at`
-- e `registrar_exclusao_sync` (mig 262).
--
-- POR QUE UMA MIGRATION SÓ PARA ISTO
-- A 282 criou a tabela; sem os gatilhos abaixo ela sincronizaria MAL, de três jeitos:
--   • sem `updated_at` automático, a mudança de status (pendente → homologada) não entraria
--     no delta — a nuvem ficaria com o pedido eternamente "pendente";
--   • sem marcador, o pull PULA a tabela cujo marcador é mais antigo que o cursor: ela
--     ficaria parada para sempre (a armadilha que a mig 264 documenta);
--   • sem gatilho de exclusão, linha apagada de um lado ressuscita no outro.
-- Os testes de cobertura do sync (`sync-config.spec.ts`) reprovam exatamente por isso.

-- ── 1) Carimbo de alteração, respeitando a marca de sessão do sync (sem eco) ──────────────
drop trigger if exists trg_bump_fiscal_inutilizacao on fiscal_inutilizacao;
create trigger trg_bump_fiscal_inutilizacao
  before update on fiscal_inutilizacao
  for each row execute function bump_updated_at();

-- ── 2) Marcador de mudança (o pull usa para saber se vale consultar a tabela) ─────────────
do $$
declare t text;
begin
  foreach t in array array['fiscal_inutilizacao'] loop
    if exists (select 1 from information_schema.tables
                where table_schema = current_schema() and table_name = t) then
      execute format('drop trigger if exists trg_sync_marcador_ins on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_upd on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_del on %I', t);
      execute format('create trigger trg_sync_marcador_ins after insert on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_upd after update on %I '
                     || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
      execute format('create trigger trg_sync_marcador_del after delete on %I '
                     || 'referencing old table as removidas for each statement execute function marcar_mudanca_sync()', t);
    end if;
  end loop;
end $$;

-- ── 3) Exclusão física sincroniza (senão a linha apagada ressuscita) ──────────────────────
do $$
declare t text;
begin
  foreach t in array array['fiscal_inutilizacao'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = t and column_name = 'tenant_id')
       and exists (select 1 from information_schema.columns
                    where table_schema = current_schema() and table_name = t and column_name = 'id' and data_type = 'uuid') then
      execute format('drop trigger if exists trg_sync_exclusao on %I', t);
      execute format('create trigger trg_sync_exclusao after delete on %I '
                     || 'for each row execute function registrar_exclusao_sync()', t);
    end if;
  end loop;
end $$;
