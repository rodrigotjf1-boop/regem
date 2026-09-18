-- 264_sync_marcador_status_fila.sql — Três estruturas novas do sync: marcador de mudança,
-- status do servidor local e fila local de pendências.
--
-- ⚠️ NÃO é @cloud-only (o edge também usa). ⚠️ ADITIVA e sem dependência de código: nada lê
-- estas tabelas até o código novo subir. Pode ir para a nuvem AGORA.
--
-- 1) sync_marcador — "esta tabela desta empresa mudou quando?"
-- HOJE o pull pergunta linha a linha para 59 TABELAS, toda vez, mesmo sem nada ter mudado.
-- É o oposto do mercado: SymmetricDS lê UMA tabela de mudanças (`sym_data`), o AppSync lê UMA
-- tabela delta e o Firestore nem pergunta (empurra). Com o marcador, o pull lê UMA linha por
-- tabela e só consulta as que mudaram depois do cursor daquele servidor local.
-- O gatilho é POR COMANDO (não por linha), com tabela de transição: uma gravação a mais por
-- INSERT/UPDATE/DELETE, não por registro afetado.
-- `balde` (0..3) espalha a escrita: sem ele, toda transação da mesma empresa na mesma tabela
-- disputaria a MESMA linha e passaria a serializar no commit.
--
-- 2) edge_status — uma linha por servidor local, atualizada a cada batida.
-- HOJE cada batida INSERE uma linha em `edge_heartbeat` (2 por ciclo). Em 5.000 lojas são
-- 14,4 milhões de linhas por dia (~14 GB/dia pela medida atual de ~1 KB por linha), sem
-- expurgo. O histórico continua existindo, mas passa a ser amostrado.
--
-- 3) sync_fila — fila local do servidor local (órfãos e exclusões pendentes).
-- HOJE isso vive dentro de UMA linha de texto JSON em `sync_state`, reescrita a cada ciclo,
-- com até 5.000 itens. Em tabela dá para indexar, contar e diagnosticar.

create table if not exists sync_marcador (
  tenant_id uuid not null,
  tabela text not null,
  balde smallint not null default 0,
  mudou_em timestamptz not null default now(),
  primary key (tenant_id, tabela, balde)
);
create index if not exists idx_sync_marcador_tenant on sync_marcador (tenant_id);

-- Duas funções, não uma com CASE: o PL/pgSQL resolve as colunas em tempo de execução, e uma
-- função que citasse `tenant_id` quebraria em `empresa` (que amarra pelo próprio `id`) —
-- qualquer INSERT/DELETE em empresa passaria a falhar com 42703.
create or replace function marcar_mudanca_sync() returns trigger as $$
declare bal smallint := (floor(random() * 4))::smallint;
begin
  if tg_op = 'DELETE' then
    insert into sync_marcador (tenant_id, tabela, balde, mudou_em)
      select distinct r.tenant_id, tg_table_name, bal, now() from removidas r where r.tenant_id is not null
    on conflict (tenant_id, tabela, balde)
      do update set mudou_em = greatest(sync_marcador.mudou_em, excluded.mudou_em);
  else
    insert into sync_marcador (tenant_id, tabela, balde, mudou_em)
      select distinct r.tenant_id, tg_table_name, bal, now() from novas r where r.tenant_id is not null
    on conflict (tenant_id, tabela, balde)
      do update set mudou_em = greatest(sync_marcador.mudou_em, excluded.mudou_em);
  end if;
  return null;
end;
$$ language plpgsql;

create or replace function marcar_mudanca_sync_empresa() returns trigger as $$
declare bal smallint := (floor(random() * 4))::smallint;
begin
  if tg_op = 'DELETE' then
    insert into sync_marcador (tenant_id, tabela, balde, mudou_em)
      select distinct r.id, tg_table_name, bal, now() from removidas r where r.id is not null
    on conflict (tenant_id, tabela, balde)
      do update set mudou_em = greatest(sync_marcador.mudou_em, excluded.mudou_em);
  else
    insert into sync_marcador (tenant_id, tabela, balde, mudou_em)
      select distinct r.id, tg_table_name, bal, now() from novas r where r.id is not null
    on conflict (tenant_id, tabela, balde)
      do update set mudou_em = greatest(sync_marcador.mudou_em, excluded.mudou_em);
  end if;
  return null;
end;
$$ language plpgsql;

-- Gatilhos nas tabelas que DESCEM (as do pull). Tabela ausente neste banco é pulada: o mesmo
-- arquivo roda na nuvem e no edge.
do $$
declare t text; fn text;
begin
  foreach t in array array[
    'empresa', 'unidade', 'setor', 'funcao',
    'perfil_acesso', 'colaborador', 'turno', 'etiqueta',
    'kds_alerta_config', 'equipamento', 'delivery_config', 'etiqueta_template',
    'categoria_produto', 'produto', 'produto_pausa_estoque', 'ficha_tecnica',
    'bot_regra', 'feriado', 'tipo_ocorrencia', 'cardapio_config',
    'opcao', 'complemento', 'complemento_item', 'produto_complemento',
    'complemento_grupo', 'complemento_opcao', 'item_estoque', 'fornecedor',
    'item_estoque_unidade', 'ficha_ingrediente', 'produto_variacao', 'produto_combo_item',
    'recebimento', 'recebimento_item', 'lote', 'desperdicio',
    'etiqueta_validade', 'contagem_lista', 'contagem_lista_item', 'contagem_execucao',
    'contagem_item', 'compra_lista', 'compra_item', 'titulo_financeiro',
    'cliente', 'caixa_sessao', 'comanda', 'comanda_item',
    'comanda_item_complemento', 'producao_pedido', 'producao_pedido_item', 'pedido_externo',
    'pedido_externo_pagamento', 'lancamento_caixa', 'movimento_estoque', 'movimento_lote',
    'sync_exclusao', 'ponto_marcacao', 'audit_log'
  ] loop
    if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t) then
      fn := case when t = 'empresa' then 'marcar_mudanca_sync_empresa' else 'marcar_mudanca_sync' end;
      execute format('drop trigger if exists trg_sync_marcador_ins on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_upd on %I', t);
      execute format('drop trigger if exists trg_sync_marcador_del on %I', t);
      execute format('create trigger trg_sync_marcador_ins after insert on %I '
                     || 'referencing new table as novas for each statement execute function %s()', t, fn);
      execute format('create trigger trg_sync_marcador_upd after update on %I '
                     || 'referencing new table as novas for each statement execute function %s()', t, fn);
      execute format('create trigger trg_sync_marcador_del after delete on %I '
                     || 'referencing old table as removidas for each statement execute function %s()', t, fn);
    end if;
  end loop;
end $$;

-- Semente: toda empresa começa com marcador de AGORA em todas as tabelas. Sem isto, o pull
-- não saberia distinguir "nunca mudou" de "não sei" e teria de consultar tudo mesmo assim.
insert into sync_marcador (tenant_id, tabela, balde, mudou_em)
select e.id, t.tabela, 0, now()
  from empresa e
  cross join (
    select table_name as tabela from information_schema.tables
     where table_schema = 'public'
       and table_name in (
       'empresa', 'unidade', 'setor', 'funcao',
       'perfil_acesso', 'colaborador', 'turno', 'etiqueta',
       'kds_alerta_config', 'equipamento', 'delivery_config', 'etiqueta_template',
       'categoria_produto', 'produto', 'produto_pausa_estoque', 'ficha_tecnica',
       'bot_regra', 'feriado', 'tipo_ocorrencia', 'cardapio_config',
       'opcao', 'complemento', 'complemento_item', 'produto_complemento',
       'complemento_grupo', 'complemento_opcao', 'item_estoque', 'fornecedor',
       'item_estoque_unidade', 'ficha_ingrediente', 'produto_variacao', 'produto_combo_item',
       'recebimento', 'recebimento_item', 'lote', 'desperdicio',
       'etiqueta_validade', 'contagem_lista', 'contagem_lista_item', 'contagem_execucao',
       'contagem_item', 'compra_lista', 'compra_item', 'titulo_financeiro',
       'cliente', 'caixa_sessao', 'comanda', 'comanda_item',
       'comanda_item_complemento', 'producao_pedido', 'producao_pedido_item', 'pedido_externo',
       'pedido_externo_pagamento', 'lancamento_caixa', 'movimento_estoque', 'movimento_lote',
       'sync_exclusao', 'ponto_marcacao', 'audit_log'
       )
  ) t
on conflict (tenant_id, tabela, balde) do nothing;

create table if not exists edge_status (
  equipamento_id uuid primary key,
  tenant_id uuid not null,
  unidade_id uuid,
  versao text,
  estado text,
  ultimo_sync timestamptz,
  disco_livre_mb integer,
  clientes integer,
  fingerprint text,
  saude jsonb,
  erro text,
  recebido_em timestamptz not null default now()
);
create index if not exists idx_edge_status_tenant on edge_status (tenant_id, unidade_id, recebido_em desc);

create table if not exists sync_fila (
  id uuid primary key default gen_random_uuid(),
  tipo text not null,                 -- 'orfao' | 'exclusao'
  tabela text not null,
  registro_id uuid,
  conteudo jsonb,
  tentativas integer not null default 0,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists idx_sync_fila_tipo on sync_fila (tipo, atualizado_em);
create unique index if not exists idx_sync_fila_registro on sync_fila (tipo, tabela, registro_id);
