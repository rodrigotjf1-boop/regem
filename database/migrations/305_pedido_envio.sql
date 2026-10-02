-- 305 — REGISTRO DOS ENVIOS DO PEDIDO: o que o Regem mandou para FORA a cada mudança de status
-- — ao canal (aceitou, pronto, saiu, concluiu, cancelou) e ao cliente (avisos) —, se deu certo e
-- o motivo quando não deu.
--
-- ⚠️ NÃO é @cloud-only: o status do pedido muda na NUVEM e no SERVIDOR DA LOJA, e cada um registra
--    o que ele mesmo tentou enviar.
-- ⚠️ NÃO sincroniza: é o diário DESTA máquina (como a `aviso_integracao`, mig 289). O servidor da
--    loja vê os envios dele; a nuvem, os dela.
-- ⚠️ Aplicar na NUVEM ANTES do merge. Sem a tabela, o envio ao canal segue exatamente igual; só o
--    registro falha (um aviso no log), e a linha do tempo do pedido fica vazia. Idempotente.
--
-- POR QUE EXISTE
--
-- Pedido do dono (02/10/2026): "verificar se os status estão mudando em todos os canais e se os
-- avisos estão sendo enviados". Não havia como verificar: o envio ao canal era uma chamada em
-- segundo plano que engolia qualquer erro — sem registro, sem tela. A decisão foi REGISTRAR E
-- MOSTRAR, sem mudar o envio: esta tabela só guarda o resultado de cada tentativa.
--
-- O QUE NÃO GUARDA: nem o corpo enviado, nem token, nem telefone do cliente. O motivo é um texto
-- curto (código HTTP + trecho da resposta do canal, aparado).
--
-- GUARDA: 90 dias (um job diário apaga o resto, em lote).

set local lock_timeout = '5s';

create table if not exists pedido_envio (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references empresa(id) on delete cascade,
  unidade_id  uuid,
  -- o pedido some (expurgo, limpeza do escopo de outra loja) → o registro dele vai junto
  pedido_id   uuid not null references pedido_externo(id) on delete cascade,
  -- para onde foi: o canal ('ifood', '99food', 'anotaai', 'cardapio_web', 'open_delivery',
  -- 'delivery_direto') ou o cliente ('cliente_whatsapp', 'cliente_cardapio'), ou 'nuvem'
  -- (o servidor da loja pedindo à nuvem que avise o cliente)
  destino     text not null,
  -- o que foi dito: confirm | ready | dispatch | delivered | finalize | finalizar | cancel
  -- (canal) ou o evento do aviso ao cliente (confirmado, saiu_entrega, entregue, cancelado…)
  acao        text not null,
  -- enviado | falhou | nao_enviado (nada saiu: sem credencial neste servidor, adiado…)
  resultado   text not null,
  motivo      text,
  http_status integer,
  duracao_ms  integer,
  -- qual servidor tentou: 'nuvem' | 'loja'
  servidor    text not null default 'nuvem',
  criado_em   timestamptz not null default now(),
  constraint ck_pedido_envio_resultado check (resultado in ('enviado', 'falhou', 'nao_enviado')),
  constraint ck_pedido_envio_motivo check (motivo is null or length(motivo) <= 400)
);

-- A linha do tempo de um pedido.
create index if not exists idx_pedido_envio_pedido
  on pedido_envio (pedido_id, criado_em);

-- O aviso do painel: o que FALHOU nas últimas horas, por empresa.
create index if not exists idx_pedido_envio_falhas
  on pedido_envio (tenant_id, criado_em desc)
  where resultado = 'falhou';

-- O expurgo diário (por data).
create index if not exists idx_pedido_envio_criado_em
  on pedido_envio (criado_em);

-- Só o app lê: sem política, a API do Supabase (anon/authenticated) não enxerga nada.
alter table pedido_envio enable row level security;

-- ===== Conferência (no mesmo Run) =====
select 'tabela pedido_envio' as objeto,
       to_regclass(current_schema() || '.pedido_envio') is not null as ok
union all
select 'colunas (12)',
       (select count(*) from information_schema.columns
         where table_schema = current_schema() and table_name = 'pedido_envio') = 12
union all
select 'chave estrangeira para o pedido (apaga junto)',
       exists (select 1 from pg_constraint c
                where c.conrelid = to_regclass(current_schema() || '.pedido_envio')
                  and c.contype = 'f' and c.confdeltype = 'c'
                  and c.confrelid = to_regclass(current_schema() || '.pedido_externo'))
union all
select 'índice da linha do tempo',
       to_regclass(current_schema() || '.idx_pedido_envio_pedido') is not null
union all
select 'índice das falhas',
       to_regclass(current_schema() || '.idx_pedido_envio_falhas') is not null
union all
select 'índice do expurgo',
       to_regclass(current_schema() || '.idx_pedido_envio_criado_em') is not null
union all
select 'RLS ligada',
       coalesce((select c.relrowsecurity from pg_class c
                  where c.oid = to_regclass(current_schema() || '.pedido_envio')), false)
union all
select 'o papel do app (regem_app) atravessa a RLS',
       coalesce((select r.rolbypassrls or r.rolsuper from pg_roles r where r.rolname = 'regem_app'), true);
