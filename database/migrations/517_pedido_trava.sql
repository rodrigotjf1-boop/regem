-- 517 — A TRAVA DO PEDIDO ENQUANTO O CLIENTE ALTERA (pedido do dono, 28/11/2026; protótipo
-- `mockups/regem-pedido-em-alteracao.html` aprovado no mesmo dia com as recomendadas, TR-1 a TR-8). Fase T1 do plano.
--
-- Quando o atendente (robô do WhatsApp) manda ao cliente a conferência de uma mudança no pedido já feito, a cozinha
-- SEGURA o pedido: "Pronto", "Despachar" e "Saiu para entrega" recusam enquanto a trava vale. A trava acaba quando o
-- cliente confirma (a mudança entra), desiste, paga o Pix do item novo, em 10 minutos sem resposta (no Pix, quando ele
-- vence) ou quando alguém da loja usa "Liberar o pedido" (senha do gerente; a mudança é descartada e o cliente avisado).
--
-- `pedido_trava`: UMA LINHA POR MUDANÇA, com o id da mudança do robô (a mesma mudança não trava duas vezes). Tabela À
-- PARTE de `pedido_externo` de propósito, como a `pedido_alteracao` (mig 362): o pedido sincroniza pela última escrita
-- da LINHA INTEIRA — a mudança de situação feita na loja apagaria a trava posta pela nuvem. Sobe e desce: a nuvem trava
-- (o robô mora lá); o servidor da loja recusa o "Pronto"/"Despachar" daqui e pode LIBERAR (sobe — a nuvem descarta a
-- mudança, cancela o Pix e avisa o cliente). A trava encerrada não volta a "ativa" (sync.service e sync-daemon).
--
-- `situacao`: ativa | confirmada | desistiu | vencida | liberada | descartada (a mudança não seguiu por outro motivo).
-- Sem CHECK: uma regra diferente entre a nuvem e a loja
-- envenenaria a linha no sync — o serviço valida (como a 362). A trava vale enquanto `situacao = 'ativa'` e `ate` não
-- passou (o fim por tempo não depende de ninguém gravar).
--
-- NÃO é @cloud-only: o KDS, o despacho e o painel do servidor da loja leem daqui.
-- ⚠️ Aplicar na NUVEM ANTES do merge (V9). Idempotente; os gatilhos vão por `create or replace trigger`, sem apagar
-- nada antes (V9, ERR-225).
set local lock_timeout = '5s';

create table if not exists pedido_trava (
  id uuid primary key,                  -- o id da mudança do robô (idempotência)
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,                      -- a loja do pedido
  pedido_id uuid not null,              -- pedido_externo.id (sem chave estrangeira: o espelho da loja tem janela)
  quer text not null default '',        -- o que o cliente quer mudar ("➕ 1 Batata frita média"), como a tela mostra
  ate timestamptz not null,             -- até quando a trava vale sem resposta
  situacao text not null default 'ativa', -- ativa | confirmada | desistiu | vencida | liberada | descartada
  motivo text,                          -- "Liberar o pedido": por quê (vai para o histórico)
  por_id uuid,                          -- quem liberou (colaborador)
  por_nome text,                        -- o nome de quem liberou, como a tela mostra
  encerrada_em timestamptz,             -- quando a trava acabou (qualquer final)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A trava ativa do pedido (a conferência em cada "Pronto"/"Despachar", o KDS e o painel) e o cursor do sync.
create index if not exists idx_pedido_trava_ativa on pedido_trava (tenant_id, pedido_id) where situacao = 'ativa';
create index if not exists idx_pedido_trava_sync on pedido_trava (tenant_id, updated_at, id);

-- O mesmo carimbo das outras tabelas sincronizadas (respeita `regem.sync`, mig 259).
create or replace trigger trg_bump_updated_at before update on pedido_trava
  for each row execute function bump_updated_at();

-- A exclusão chega ao outro lado (mig 262), e o marcador de mudança (mig 264) diz ao pull quando consultar a tabela.
-- O teste do sync lê os nomes do `array[...]`.
do $$
declare t text;
begin
  foreach t in array array['pedido_trava'] loop
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
alter table pedido_trava enable row level security;

-- ===== Conferência (no mesmo Run): as quatro linhas têm de vir com `ok = true` =====
select 'tabela pedido_trava' as objeto,
       to_regclass(current_schema() || '.pedido_trava') is not null as ok
union all
select 'colunas de pedido_trava (13)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'pedido_trava'
           and column_name in ('id', 'tenant_id', 'unidade_id', 'pedido_id', 'quer', 'ate', 'situacao', 'motivo',
                               'por_id', 'por_nome', 'encerrada_em', 'created_at', 'updated_at')) = 13
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pedido_trava'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pedido_trava');
