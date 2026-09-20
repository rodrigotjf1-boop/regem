-- 276_paridade_cliente_endereco_bairro.sql — endereço do cliente e frete por bairro
-- passam a existir no servidor local.
--
-- ⚠️ NÃO é @cloud-only: as duas tabelas são lidas pelo painel de Delivery que roda na
--    loja. Aplicar nos dois bancos.
-- ⚠️ Aplicar ANTES do merge. Idempotente. Depende da 259, 262 e 264.
--
-- POR QUÊ
-- `cardapio_bairro` é a tabela do FRETE POR BAIRRO. O painel de Delivery da loja a lê em
-- dois caminhos: o seletor de bairro do endereço e o recálculo da taxa quando alguém
-- corrige o endereço de um pedido. Como ela nunca sincronizou, no servidor local está
-- VAZIA: o seletor aparece sem nenhuma opção e o pedido corrigido sai com a taxa antiga
-- (ou zero) — cobrança errada no cliente, em silêncio.
--
-- `cliente_endereco` é o endereço de entrega do cliente. O pedido em si não sofre (ele
-- carrega uma cópia do endereço), mas o CADASTRO de pedido novo no balcão sim: o
-- atendente digita o telefone de um cliente recorrente e não vem nada — nem o nome —
-- e ele redigita o endereço inteiro a cada pedido.
--
-- Nenhuma das duas tinha coluna de data: sem marca-d'água o sync não consegue levar nada.

-- ── 1) Colunas de data ────────────────────────────────────────────────────────────────
alter table cliente_endereco add column if not exists atualizado_em timestamptz not null default now();
alter table cardapio_bairro  add column if not exists criado_em     timestamptz not null default now();
alter table cardapio_bairro  add column if not exists atualizado_em timestamptz not null default now();

-- Alinha com a data real (senão o primeiro ciclo trata tudo como "mudou agora").
update cliente_endereco set atualizado_em = criado_em where criado_em is not null and atualizado_em > criado_em;

-- ── 2) Carimbo automático ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['cliente_endereco','cardapio_bairro'] loop
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = t and column_name = 'atualizado_em') then
      execute format('drop trigger if exists trg_bump_atualizado_em on %I', t);
      execute format('create trigger trg_bump_atualizado_em before update on %I '
                     || 'for each row execute function bump_atualizado_em()', t);
    end if;
  end loop;
end $$;

-- ── 3) Marcador de mudança e exclusão ─────────────────────────────────────────────────
-- O bairro é regravado por apagar-e-inserir quando o lojista salva a lista de fretes;
-- sem o gatilho de exclusão, o bairro removido ressuscitaria do outro lado.
do $$
declare t text;
begin
  foreach t in array array['cliente_endereco','cardapio_bairro'] loop
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

-- ── 4) Índices ────────────────────────────────────────────────────────────────────────
create index if not exists idx_cliente_endereco_sync on cliente_endereco (tenant_id, atualizado_em, id);
create index if not exists idx_cardapio_bairro_sync on cardapio_bairro (tenant_id, atualizado_em, id);
-- Busca do atendente: telefone do cliente → endereços salvos.
create index if not exists idx_cliente_endereco_cliente on cliente_endereco (cliente_id);
