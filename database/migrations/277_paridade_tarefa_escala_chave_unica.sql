-- 277_paridade_tarefa_escala_chave_unica.sql — tarefa e escala passam a sincronizar sem
-- duplicar.
--
-- ⚠️ NÃO é @cloud-only: as duas nascem dos dois lados. Aplicar nos dois bancos.
-- ⚠️ Aplicar ANTES do merge. Idempotente.
--
-- POR QUÊ ESTAS DUAS FICARAM PARA O FIM
-- Tarefa e escala são MATERIALIZADAS por rotina: a rotina cria a instância do dia a
-- partir da definição. A rotina roda na nuvem e no servidor local. Se as duas tabelas
-- entrassem no sync como estavam, cada lado criaria a SUA linha para o mesmo dia — com
-- `id` diferente — e o sincronismo, que casa por `id`, não teria como saber que são a
-- mesma tarefa: em vez de conciliar, DUPLICARIA. A tarefa apareceria duas vezes no Meu
-- Dia e a mesma pessoa apareceria escalada duas vezes no mesmo turno.
--
-- A trava que faltava é uma CHAVE DE NEGÓCIO: o que identifica a linha para o ser humano.
--   • tarefa:  a definição, a loja e o dia;
--   • escala:  a loja, o dia, o turno e a pessoa.
-- Com ela, a segunda tentativa não vira linha nova — e é o banco que garante, não a ordem
-- em que as coisas chegam.
--
-- A chave ignora linha excluída (`deleted_at`), senão apagar e recriar no mesmo dia
-- esbarraria no que já foi apagado. Vaga de escala em aberto (sem pessoa) fica de fora:
-- várias vagas no mesmo turno são legítimas.

-- ── 1) Duplicata existente ABORTA a migration, com o número na mensagem ───────────────
-- Criar a chave única com duplicata no banco falharia com um erro obscuro de índice.
-- Aqui a migration para antes de tocar em nada e diz exatamente o que conferir.
do $$
declare n_tarefa int; n_escala int;
begin
  select count(*) into n_tarefa from (
    select 1 from tarefa_instancia where deleted_at is null
     group by tenant_id, unidade_id, tarefa_def_id, data having count(*) > 1) x;
  select count(*) into n_escala from (
    select 1 from escala_alocacao
     where deleted_at is null and colaborador_id is not null
     group by tenant_id, unidade_id, data, turno_id, colaborador_id having count(*) > 1) y;
  if n_tarefa > 0 or n_escala > 0 then
    raise exception 'Migration 277 abortada: % grupo(s) de tarefa e % de escala já estão duplicados. Resolva antes (a consulta do cabeçalho mostra quais) — criar a chave única agora falharia no meio.', n_tarefa, n_escala;
  end if;
end $$;

-- ── 1b) O id passa a NASCER da chave de negócio ───────────────────────────────────────
-- A chave única sozinha não bastaria. O sincronismo casa linha por `id`: com id aleatório,
-- cada lado cria a MESMA tarefa com id diferente, e o que chega do outro lado esbarraria
-- na chave única — trocaríamos duplicação silenciosa por erro de sincronismo.
-- A saída é a mesma já usada na pausa por estoque (mig 260/261): id DETERMINÍSTICO,
-- calculado da chave de negócio. Os dois lados chegam ao mesmo id sem combinar nada, e
-- o upsert por id concilia em vez de duplicar.
--
-- As linhas que já existem precisam ser reescritas para o id novo, senão a primeira linha
-- vinda do outro lado bateria na chave única. `ausencia` é a única que aponta para a
-- escala; o update acompanha.
do $$
begin
  -- Tarefa: id = md5(def + loja + dia).
  update tarefa_instancia t
     set id = md5(t.tarefa_def_id::text || coalesce(t.unidade_id::text, '') || t.data::text)::uuid
   where t.deleted_at is null
     and t.id is distinct from md5(t.tarefa_def_id::text || coalesce(t.unidade_id::text, '') || t.data::text)::uuid;

  -- Escala com pessoa definida: id = md5(loja + dia + turno + pessoa). Vaga em aberto
  -- (sem pessoa) fica com o id que tem — ela não é materializada pelos dois lados.
  update ausencia a
     set cobertura_alocacao_id = md5(e.unidade_id::text || e.data::text || e.turno_id::text || e.colaborador_id::text)::uuid
    from escala_alocacao e
   where a.cobertura_alocacao_id = e.id and e.deleted_at is null and e.colaborador_id is not null;

  update escala_alocacao e
     set id = md5(e.unidade_id::text || e.data::text || e.turno_id::text || e.colaborador_id::text)::uuid
   where e.deleted_at is null and e.colaborador_id is not null
     and e.id is distinct from md5(e.unidade_id::text || e.data::text || e.turno_id::text || e.colaborador_id::text)::uuid;
end $$;

-- ── 2) A chave de negócio ─────────────────────────────────────────────────────────────
create unique index if not exists uq_tarefa_instancia_negocio
  on tarefa_instancia (tenant_id, unidade_id, tarefa_def_id, data)
  where deleted_at is null;

create unique index if not exists uq_escala_alocacao_negocio
  on escala_alocacao (tenant_id, unidade_id, data, turno_id, colaborador_id)
  where deleted_at is null and colaborador_id is not null;

-- ── 3) Índices do delta ───────────────────────────────────────────────────────────────
create index if not exists idx_tarefa_instancia_sync on tarefa_instancia (tenant_id, updated_at, id);
create index if not exists idx_escala_alocacao_sync on escala_alocacao (tenant_id, updated_at, id);

-- ── 4) Marcador de mudança e exclusão ─────────────────────────────────────────────────
-- O carimbo de `updated_at` já veio na mig 272; faltavam estes dois para o pull enxergar
-- a tabela e para a exclusão de um lado apagar do outro.
do $$
declare t text;
begin
  foreach t in array array['tarefa_instancia','escala_alocacao'] loop
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
      execute format('drop trigger if exists trg_sync_exclusao on %I', t);
      execute format('create trigger trg_sync_exclusao after delete on %I '
                     || 'for each row execute function registrar_exclusao_sync()', t);
    end if;
  end loop;
end $$;
