-- 294 — O entregador do pedido de MARKETPLACE, como o canal vê (99Food; decisão do dono, 29/09/2026).
--
-- Dois lados da mesma coisa, numa linha por pedido:
--  • LOGÍSTICA DA 99 (delivery_type=1): a 99 escolhe o entregador e avisa a loja pelo webhook
--    `deliveryStatus` (120 a caminho da loja, 130 chegou na loja, 140 saiu com o pedido, 150 chegou no
--    cliente, 160 entregue, 170/190 entrega cancelada/interrompida, 180 entregador trocado), com nome,
--    telefone e a previsão de chegada na loja. O painel do delivery e o KDS mostram isso — antes o
--    Regem só dizia "ack" e jogava fora.
--  • ENTREGA DA LOJA pela 99 (delivery_type=2): o Regem avisa a 99 que o pedido "saiu para entrega"
--    (`selfdelivery/dispatch`, com nome e telefone do entregador e a previsão) e manda a posição do
--    entregador (`updateCourierTrack`) para o cliente acompanhar no app da 99. Aqui fica o controle
--    desse aviso (quando saiu, o erro, as tentativas e os limites de tempo enviados).
--
-- Tabela SEPARADA de `pedido_externo` de propósito: `pedido_externo` sincroniza nos dois sentidos por
-- última-escrita da LINHA INTEIRA — a loja mexendo no pedido (KDS marca pronto) antes de puxar a
-- novidade devolveria a coluna velha e apagaria o "chegou na loja" na nuvem. Esta tabela só a NUVEM
-- escreve (webhook e verificador) e ela só DESCE para o servidor da loja.
--
-- Sem chave estrangeira para `pedido_externo`: no servidor da loja o pedido antigo pode não estar na
-- janela do espelho, e a linha daqui não pode ser recusada por isso.
--
-- NÃO é @cloud-only: o painel e o KDS do servidor da loja leem daqui.
-- ⚠️ Aplicar na NUVEM ANTES do merge. Idempotente.

create table if not exists pedido_logistica (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references empresa(id) on delete cascade,
  pedido_id uuid not null,
  canal text not null,
  modo text not null,                    -- 'logistica_canal' | 'propria_canal'
  -- Logística do canal (webhook):
  status integer,                         -- código do canal (99: 120..190)
  entregador_nome text,
  entregador_telefone text,
  chegada_loja_prevista timestamptz,      -- 99: rider_to_B_ETA
  evento_em timestamptz,                  -- quando o CANAL gerou o evento (descarta evento velho fora de ordem)
  -- Entrega da loja (nosso aviso ao canal):
  despacho_enviado_em timestamptz,
  despacho_erro text,
  despacho_tentativas integer not null default 0,
  limite_coleta timestamptz,
  limite_entrega timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_pedido_logistica_pedido on pedido_logistica (pedido_id);
create index if not exists idx_pedido_logistica_tenant_upd on pedido_logistica (tenant_id, updated_at);

-- O cursor do sync é updated_at: toda escrita tem de avançá-lo (mesmo gatilho da mig 095).
do $$
begin
  if exists (select 1 from pg_proc where proname = 'bump_updated_at') then
    drop trigger if exists trg_bump_updated_at on pedido_logistica;
    create trigger trg_bump_updated_at before update on pedido_logistica
      for each row execute function bump_updated_at();
  end if;
end $$;

-- Gatilhos do sync, JUNTO com a tabela (lição da 282/283): o marcador de mudança (mig 264 — o
-- servidor da loja só puxa quando algo mudou) e o registro de exclusão (mig 262).
do $$
declare t text;
begin
  foreach t in array array['pedido_logistica'] loop
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
