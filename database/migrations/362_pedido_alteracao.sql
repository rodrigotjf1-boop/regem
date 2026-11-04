-- 362 — PEDIDO ALTERADO (pedido do dono, 03/11/2026; protótipo `mockups/regem-alteracao-pedido.html` aprovado no mesmo
-- dia — decisões 3A, 5A, 6A, 7 e 8). PR 2 do plano: a alteração da EQUIPE funcionando de ponta a ponta.
--
-- 1. `pedido_alteracao`: o histórico das alterações do pedido de canal — quem, quando, de onde (equipe | robô), o que
--    mudou, os valores de antes e de agora, as vias que saíram. UMA LINHA POR ALTERAÇÃO, com o id vindo de quem pede
--    (a mesma alteração mandada duas vezes não entra duas vezes). Tabela À PARTE de `pedido_externo` de propósito, como a
--    `pedido_chegada` (mig 354) e a `pedido_repetido_ok` (mig 360): o pedido sincroniza pela última escrita da LINHA
--    INTEIRA. `situacao` (aplicada | pedida | recusada) e `pedido` (o que foi pedido) servem à alteração pedida na tela da
--    nuvem para a loja que tem servidor ligado — o servidor da loja aplica (V53). Sobe e desce.
-- 2. O "Visto" do cartão do KDS: `producao_pedido.alterado_em` (a cozinha precisa ver a mudança), `visto_em` e
--    `visto_por` (quem tocou em "Visto"). O aviso grande fica enquanto `visto_em` for nulo ou mais velho que
--    `alterado_em`. `producao_pedido_item.mudou_em`: quando o item entrou (NOVO) ou saiu (TIRAR) por uma alteração — o
--    item tirado continua no cartão, riscado, até o "Visto".
-- 3. O ajuste do som em `kds_cor_config` (sincroniza nos dois sentidos; herança loja → empresa → padrão no leitor,
--    V59): `alterado_som` = 'uma' | '1min' | '2min'; nulo = herda (padrão '1min', decisão 6A). Sem CHECK: uma regra
--    diferente entre a nuvem e a loja envenenaria a linha no sync — o serviço valida.
--
-- NÃO é @cloud-only: o KDS, a via e o painel do servidor da loja leem daqui.
-- ⚠️ Aplicar na NUVEM ANTES do merge (V9; ERR-029: o Drizzle nomeia todas as colunas no select). Idempotente; os gatilhos
-- vão por `create or replace trigger`, sem `drop` (V9, ERR-225). `add column` sem valor padrão não reescreve a tabela.
set local lock_timeout = '5s';

create table if not exists pedido_alteracao (
  id uuid primary key,                  -- vem de quem pede (idempotência)
  tenant_id uuid not null references empresa(id) on delete cascade,
  unidade_id uuid,                      -- a loja do pedido
  pedido_id uuid not null,              -- pedido_externo.id (sem chave estrangeira: o espelho da loja tem janela)
  comanda_id uuid,                      -- a venda do pedido
  origem text not null default 'equipe', -- equipe | robo
  situacao text not null default 'aplicada', -- aplicada | pedida (nuvem → servidor da loja) | recusada
  motivo text,                          -- por que foi recusada
  por_id uuid,                          -- quem alterou (colaborador)
  por_nome text,                        -- o nome de quem alterou, como a tela mostra
  pedido jsonb,                         -- o que foi pedido (adicionar, remover, endereço, troco)
  mudanca jsonb not null default '{}'::jsonb, -- o que mudou: { itens: [{ acao, descricao, quantidade, valor }], endereco }
  antes jsonb,                          -- { total, taxaEntrega, trocoPara, cashback, endereco }
  depois jsonb,
  vias jsonb,                           -- as vias que saíram: [{ impressora, via }]
  pedido_do_cliente text,               -- o que o cliente pediu (robô)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- O histórico do pedido (gaveta do painel) e o cursor do sync (tenant, updated_at, id).
create index if not exists idx_pedido_alteracao_pedido on pedido_alteracao (tenant_id, pedido_id, created_at);
create index if not exists idx_pedido_alteracao_sync on pedido_alteracao (tenant_id, updated_at, id);

-- O mesmo carimbo das outras tabelas sincronizadas (respeita `regem.sync`, mig 259).
create or replace trigger trg_bump_updated_at before update on pedido_alteracao
  for each row execute function bump_updated_at();

-- A exclusão chega ao outro lado (mig 262), e o marcador de mudança (mig 264) diz ao pull quando consultar a tabela.
-- O teste do sync lê os nomes do `array[...]`.
do $$
declare t text;
begin
  foreach t in array array['pedido_alteracao'] loop
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
alter table pedido_alteracao enable row level security;

-- O "Visto" do cartão do KDS e o momento em que o item entrou ou saiu.
alter table producao_pedido add column if not exists alterado_em timestamptz;
alter table producao_pedido add column if not exists visto_em timestamptz;
alter table producao_pedido add column if not exists visto_por text;
alter table producao_pedido_item add column if not exists mudou_em timestamptz;

-- O som do KDS no pedido alterado (Delivery › Configurações › Operação › Atendimento › "Pedido alterado").
alter table kds_cor_config add column if not exists alterado_som text;

-- ===== Conferência (no mesmo Run): as seis linhas têm de vir com `ok = true` =====
select 'tabela pedido_alteracao' as objeto,
       to_regclass(current_schema() || '.pedido_alteracao') is not null as ok
union all
select 'colunas de pedido_alteracao (18)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'pedido_alteracao'
           and column_name in ('id', 'tenant_id', 'unidade_id', 'pedido_id', 'comanda_id', 'origem', 'situacao',
                               'motivo', 'por_id', 'por_nome', 'pedido', 'mudanca', 'antes', 'depois', 'vias',
                               'pedido_do_cliente', 'created_at', 'updated_at')) = 18
union all
select 'gatilhos (carimbo, exclusão e os 3 do marcador)',
       (select count(*) from pg_trigger g join pg_class c on c.oid = g.tgrelid
         join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pedido_alteracao'
           and g.tgname in ('trg_bump_updated_at', 'trg_sync_exclusao', 'trg_sync_marcador_ins',
                            'trg_sync_marcador_upd', 'trg_sync_marcador_del')
           and not g.tgisinternal) = 5
union all
select 'RLS ligada',
       (select c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = current_schema() and c.relname = 'pedido_alteracao')
union all
select 'colunas do Visto no cartão e no item (4)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema()
           and ((table_name = 'producao_pedido' and column_name in ('alterado_em', 'visto_em', 'visto_por'))
             or (table_name = 'producao_pedido_item' and column_name = 'mudou_em'))) = 4
union all
select 'coluna kds_cor_config.alterado_som',
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'kds_cor_config'
                  and column_name = 'alterado_som');
