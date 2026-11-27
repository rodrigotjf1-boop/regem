-- 512 — Os DIAS ESPECIAIS do horário da loja (fase H1; protótipo `mockups/regem-dias-especiais.html`, aprovado pelo dono em
-- 27/11/2026 com as nove decisões recomendadas).
--
-- Até aqui o horário da loja era só por dia da semana (`cardapio_config.horarios` e `horarios_retirada`): no Natal o
-- cardápio abria, o pedido agendado oferecia janela num dia em que a loja não ia abrir e o atendente dizia "sexta abrimos às
-- 18:00". Um dia especial diz como a loja fica numa data (ou num período, `data_fim`): fechada, outro horário (`abre`,
-- `fecha`) ou o horário normal confirmado (só para o Regem parar de perguntar sobre aquele feriado). A regra de leitura é
-- uma só (`backend/src/common/horario-da-data.ts`): as aberturas de uma data = as do dia especial, senão as da semana.
--
-- POR QUE UMA TABELA PRÓPRIA (decisão 1): o feriado da escala (`dia_especial`) mistura férias e folgas de pessoas, e os
-- eventos do calendário do Marketing (`evento_loja`) são só da nuvem — o horário é da LOJA e tem de valer no servidor dela.
-- Os feriados daquelas listas viram sugestão na tela (fase H2), ligados por `feriado_chave`.
--
-- Por loja: `unidade_id` nulo = a empresa toda (o cardápio sem loja, que é o caso de hoje). Sem `check` nos códigos de
-- propósito (como a 392): a linha de uma versão mais nova não pode travar o sync de um servidor de loja mais antigo — quem
-- confere é o serviço. Excluir = `deleted_at` (a linha some das leituras e a exclusão viaja pelo sync como uma mudança).
-- `pausar_canais` (iFood e 99 pausados sozinhos) só passa a valer na fase H3; `aviso_antes` (o aviso no cardápio 3 dias
-- antes) já na H1.
--
-- NÃO é @cloud-only: o painel do servidor da loja também mostra e edita. Sincroniza nos dois sentidos (sync-config 'ambos'
-- + PUSH_TABLES do daemon). ⚠️ Aplicar na NUVEM ANTES do merge: o cardápio online passa a ler esta tabela. Idempotente; os
-- gatilhos vão por `create or replace trigger` (V9).

create table if not exists horario_especial (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,
  data date not null,
  data_fim date,                  -- último dia do período (inclusive); nulo = só a data
  nome text not null,             -- o que o cliente vê ("Natal"), até 40 letras
  funcionamento text not null,    -- fechada | horario | normal
  abre text,                      -- "HH:MM" (só em "horario")
  fecha text,                     -- "HH:MM"; antes de abrir = vira a meia-noite
  conjunto text not null default 'todos', -- todos | entrega | retirada
  pausar_canais boolean not null default true,
  aviso_antes boolean not null default true,
  feriado_chave text,             -- o feriado das listas de hoje a que este dia responde (fase H2)
  origem text not null default 'tela', -- tela | mister | sugestao
  criado_por uuid,
  criado_por_nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

-- A leitura do cardápio: os dias de uma loja numa faixa de datas (só os que valem).
create index if not exists idx_horario_especial_loja
  on horario_especial (tenant_id, unidade_id, data) where deleted_at is null;
-- SEM índice único do dia (ERR-640, exceção da V24): a tabela sincroniza nos DOIS sentidos — o mesmo dia criado na loja e
-- na nuvem antes do sync teria ids diferentes e o lote bateria no 23505 para sempre. Quem impede o dia repetido é o
-- serviço (a conferência dos períodos que se cruzam DENTRO da transação, com a trava da empresa); o par que nasce das duas
-- pontas fica visível na lista e a leitura escolhe sempre o mesmo (o mais recente). Este arquivo criava
-- `ux_horario_especial_dia` (27/11) e o servidor da loja reaplica TODAS as migrations a cada atualização: por isso o índice
-- saiu daqui (senão voltaria a cada atualização — e com um par na loja, o 23505 abortaria a atualização inteira); a 515
-- tira o índice de quem já tinha rodado este arquivo (a nuvem).
create index if not exists idx_horario_especial_sync on horario_especial (tenant_id, updated_at, id);

-- A mudança propaga pelo sync: o mesmo carimbo das outras tabelas sincronizadas (respeita `regem.sync`, mig 259).
create or replace trigger trg_bump_updated_at before update on horario_especial
  for each row execute function bump_updated_at();

-- A exclusão (a empresa apagada leva a linha junto) chega ao outro lado (mig 262), e o marcador de mudança (mig 264) diz
-- ao pull quando consultar a tabela. O teste do sync lê os nomes do `array[...]`.
do $$
declare t text;
begin
  foreach t in array array['horario_especial'] loop
    execute format('create or replace trigger trg_sync_exclusao after delete on %I '
                   || 'for each row execute function registrar_exclusao_sync()', t);
    execute format('create or replace trigger trg_sync_marcador_ins after insert on %I '
                   || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
    execute format('create or replace trigger trg_sync_marcador_upd after update on %I '
                   || 'referencing new table as novas for each statement execute function marcar_mudanca_sync()', t);
    execute format('create or replace trigger trg_sync_marcador_del after delete on %I '
                   || 'referencing old table as removidas for each statement execute function marcar_mudanca_sync()', t);
  end loop;
end $$;

-- Só o app lê: sem política, a API do Supabase (anon/authenticated) não enxerga nada.
alter table horario_especial enable row level security;

-- ===== Conferência (no mesmo Run): as cinco linhas têm de vir com `ok = true` =====
select 'tabela horario_especial' as objeto,
       to_regclass(current_schema() || '.horario_especial') is not null as ok
union all
select 'colunas (19)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'horario_especial'
           and column_name in ('id', 'tenant_id', 'unidade_id', 'data', 'data_fim', 'nome', 'funcionamento', 'abre', 'fecha',
                               'conjunto', 'pausar_canais', 'aviso_antes', 'feriado_chave', 'origem', 'criado_por',
                               'criado_por_nome', 'created_at', 'updated_at', 'deleted_at')) = 19
union all
select 'índices (loja, sync)',
       to_regclass(current_schema() || '.idx_horario_especial_loja') is not null
       and to_regclass(current_schema() || '.idx_horario_especial_sync') is not null
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'horario_especial'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'horario_especial');
