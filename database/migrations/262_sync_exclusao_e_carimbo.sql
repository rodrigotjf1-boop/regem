-- 262_sync_exclusao_e_carimbo.sql — Exclusão física e edição sem carimbo passam a sincronizar.
--
-- ⚠️ NÃO é @cloud-only: nuvem e edge gravam e aplicam. Aplicar nos dois (o edge pelo pacote).
-- ⚠️ Aplicar ANTES do merge (tabela nova lida pelo push/pull). Idempotente.
-- Depende da 259 (marca de sessão `regem.sync`).
--
-- DEFEITO 1 — EXCLUSÃO FÍSICA NÃO SINCRONIZA
-- O sync só leva linhas que EXISTEM. Uma linha apagada com DELETE continua viva do outro lado:
--   • item removido da comanda aberta → a nuvem segue com o item (produtos vendidos contam a mais);
--   • cliente apagado pelo "esquecer" (LGPD) na nuvem → a cópia no servidor local NÃO era apagada;
--   • comanda da mesa excluída, impressora removida, pagamento dividido refeito (delete + insert)…
-- CORREÇÃO: um gatilho AFTER DELETE grava (empresa, tabela, id) em `sync_exclusao`, que sincroniza
-- nos dois sentidos; quem recebe apaga a mesma linha do seu lado. Aplicação feita PELO SYNC
-- (sessão marcada `regem.sync = on`) não gera registro — senão a exclusão voltaria em eco.
-- Nenhuma leitura do sistema muda: a linha continua sendo apagada de verdade, dos dois lados.
--
-- DEFEITO 2 — EDIÇÃO SEM CARIMBO
-- Quinze tabelas sincronizadas não tinham gatilho de updated_at: a edição só propagava se o código
-- gravasse a data à mão, e cinco pontos não gravavam — editar/excluir fornecedor, EXCLUIR PRODUTO
-- (seguia ativo do outro lado), pausar canal do produto (a nuvem recusava o envio), excluir grupo/
-- opção de complemento, excluir regra do bot. CORREÇÃO: o mesmo gatilho das demais tabelas, que
-- desde a 259 respeita a marca de sessão do sync (sem pingue-pongue).

-- ── 1) Registro de exclusões ────────────────────────────────────────────────────────────────
create table if not exists sync_exclusao (
  id uuid primary key default gen_random_uuid(),
  -- Sem FK de propósito: o registro precisa sobreviver à linha apagada e chegar ao outro lado
  -- em qualquer ordem (mesma razão do movimento_lote, mig 248).
  tenant_id uuid not null,
  tabela text not null,
  registro_id uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_sync_exclusao_sync on sync_exclusao (tenant_id, created_at, id);

create or replace function registrar_exclusao_sync() returns trigger as $$
begin
  if coalesce(current_setting('regem.sync', true), '') = 'on' then
    return old;
  end if;
  insert into sync_exclusao (tenant_id, tabela, registro_id) values (old.tenant_id, tg_table_name, old.id);
  return old;
end;
$$ language plpgsql;

-- Tabelas sincronizadas que descem e/ou sobem com estado (as de só-anexar — movimento de
-- estoque, de lote, caixa, ponto, auditoria — nunca são apagadas). `empresa` fica de fora
-- (não tem tenant_id; a exclusão da empresa não é operação de sync). Tabela ou coluna que não
-- existe neste banco é pulada: o mesmo arquivo roda na nuvem e em edge de qualquer versão.
do $$
declare t text;
begin
  foreach t in array array[
    'unidade','setor','funcao','perfil_acesso','colaborador','turno','etiqueta','kds_alerta_config',
    'equipamento','delivery_config','etiqueta_template','categoria_produto','produto',
    'produto_pausa_estoque','ficha_tecnica','bot_regra','feriado','tipo_ocorrencia','cardapio_config',
    'opcao','complemento','complemento_item','produto_complemento','complemento_grupo',
    'complemento_opcao','item_estoque','fornecedor','item_estoque_unidade','ficha_ingrediente',
    'produto_variacao','produto_combo_item','recebimento','recebimento_item','lote','desperdicio',
    'etiqueta_validade','contagem_lista','contagem_lista_item','contagem_execucao','contagem_item',
    'compra_lista','compra_item','titulo_financeiro','cliente','caixa_sessao','comanda',
    'comanda_item','comanda_item_complemento','producao_pedido','producao_pedido_item',
    'pedido_externo','pedido_externo_pagamento'
  ] loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = t and column_name = 'tenant_id')
       and exists (select 1 from information_schema.columns
                    where table_schema = 'public' and table_name = t and column_name = 'id' and data_type = 'uuid') then
      execute format('drop trigger if exists trg_sync_exclusao on %I', t);
      execute format('create trigger trg_sync_exclusao after delete on %I '
                     || 'for each row execute function registrar_exclusao_sync()', t);
    end if;
  end loop;
end $$;

-- ── 2) Carimbo de updated_at nas tabelas sincronizadas que não tinham gatilho ─────────────────
do $$
declare t text;
begin
  foreach t in array array[
    'perfil_acesso','kds_alerta_config','categoria_produto','produto','bot_regra','cardapio_config',
    'opcao','complemento','complemento_item','produto_complemento','complemento_grupo',
    'complemento_opcao','fornecedor','item_estoque_unidade'
  ] loop
    if exists (select 1 from information_schema.columns
                where table_schema = 'public' and table_name = t and column_name = 'updated_at') then
      execute format('drop trigger if exists trg_bump_updated_at on %I', t);
      execute format('create trigger trg_bump_updated_at before update on %I '
                     || 'for each row execute function bump_updated_at()', t);
    end if;
  end loop;
end $$;

-- `cliente` usa `atualizado_em` (não `updated_at`): função própria, mesma regra da marca de sessão.
create or replace function bump_atualizado_em() returns trigger as $$
begin
  if coalesce(current_setting('regem.sync', true), '') = 'on' then
    return new;
  end if;
  new.atualizado_em = now();
  return new;
end;
$$ language plpgsql;

do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'public' and table_name = 'cliente' and column_name = 'atualizado_em') then
    drop trigger if exists trg_bump_atualizado_em on cliente;
    create trigger trg_bump_atualizado_em before update on cliente
      for each row execute function bump_atualizado_em();
  end if;
end $$;
