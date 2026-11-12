-- 413 — O lançamento de caixa ALTERADO na loja chega à nuvem (verificação pedida pelo dono em 12/11/2026).
--
-- O DEFEITO (conferido na nuvem em 12/11: 74 lançamentos de venda sem caixa cujo pedido tem caixa — 64 retiradas de
-- 27/10 no PDV1, R$ 3.519,49, 7 entregas de outubro e 3 de agosto)
-- A `lancamento_caixa` sincronizava como livro "só de acréscimo": sobe uma vez pela data de criação e a nuvem ignora a
-- repetição (`on conflict do nothing` — sem `updated_at`, o push não tem como saber qual é a mais nova). Mas cinco caminhos
-- MUDAM o lançamento depois de gravado: o "Cobrar e entregar" da retirada e da entrega (`entregarBalcao`, o recebimento
-- do entregador, o balcão) aponta o lançamento da venda para o caixa de quem recebeu, com a forma recebida; o dinheiro do
-- delivery vai para o caixa de entregas; o pedido alterado (mig 362) muda o valor. Na loja com servidor a mudança ficava
-- só na loja: na nuvem o lançamento seguia sem caixa (fora do fechamento do turno nos relatórios da nuvem), com a forma
-- que o canal disse e o valor antigo.
--
-- A CORREÇÃO
--  1. `updated_at` na `lancamento_caixa` (preenchido com o `created_at` — nada que já subiu sobe de novo), o carimbo de
--     sempre (`bump_updated_at`, que não carimba o que o sync aplica — mig 259) e o índice do envio da loja.
--     Com a coluna, o push da nuvem passa sozinho a "a mais nova vence" (`sync.service`: tabela com `updated_at` = LWW),
--     e o servidor da loja envia pelo `updated_at` (sync-daemon, PUSH_TABLES — vai no `.exe`). O pull segue pela data de
--     criação (a nuvem não muda o lançamento da loja com servidor; descer a correção do item 2 sobrescreveria a loja).
--  2. NA NUVEM, os lançamentos de venda sem caixa cujo pedido do canal tem o caixa de quem recebeu: o caixa e a forma do
--     pedido (o MESMO que o serviço grava nos dois — `delivery.service`). O servidor da loja reenvia uma vez os que ele
--     apontou para um caixa (sync-daemon, `reenviarLancamentosDoCaixa`), e a cópia dele, mais nova, vence.
--
-- ⚠️ NÃO é @cloud-only: aplicar na NUVEM antes do merge; na loja vai com o `.zip` (o item 2 só roda onde há `edge_status`,
-- isto é, na nuvem). Idempotente.
set local lock_timeout = '5s';

alter table lancamento_caixa add column if not exists updated_at timestamptz;
update lancamento_caixa set updated_at = created_at where updated_at is null;
alter table lancamento_caixa alter column updated_at set default now();
alter table lancamento_caixa alter column updated_at set not null;

-- O envio da loja lê "(updated_at, id) depois do cursor" em ordem, sem filtro de empresa (o banco é de uma loja só).
create index if not exists idx_lancamento_caixa_updated_at on lancamento_caixa (updated_at, id);

create or replace trigger trg_bump_updated_at before update on lancamento_caixa
  for each row execute function bump_updated_at();

-- 2. Só na nuvem (o servidor da loja não tem `edge_status`): o caixa e a forma que o pedido já tem. O gatilho acima
--    carimba `updated_at = now()` nas linhas corrigidas.
do $$
begin
  if to_regclass(current_schema() || '.edge_status') is not null then
    update lancamento_caixa l
       set sessao_id = pe.caixa_sessao_id,
           forma = coalesce(nullif(btrim(pe.forma_pagamento), ''), l.forma)
      from pedido_externo pe
      join caixa_sessao s on s.id = pe.caixa_sessao_id and s.tenant_id = pe.tenant_id
     where pe.tenant_id = l.tenant_id
       and pe.comanda_id = l.comanda_id
       and pe.caixa_sessao_id is not null
       and l.sessao_id is null
       and l.tipo = 'entrada'
       and l.categoria = 'venda';
  end if;
end $$;

comment on column lancamento_caixa.updated_at is
  'Quando o lançamento mudou por último (o caixa e a forma no recebimento, o valor no pedido alterado); o sync sobe pela mais nova (mig 413).';

-- Conferência (mesmo Run): tudo `ok`.
select 'coluna updated_at (não nula)' as objeto,
       (select is_nullable = 'NO' from information_schema.columns
         where table_schema = current_schema() and table_name = 'lancamento_caixa' and column_name = 'updated_at') as ok
union all
select 'nenhum lançamento sem updated_at',
       not exists (select 1 from lancamento_caixa where updated_at is null)
union all
select 'gatilho de carimbo',
       exists (select 1 from pg_trigger g join pg_class c on c.oid = g.tgrelid
                 join pg_namespace n on n.oid = c.relnamespace
                where n.nspname = current_schema() and c.relname = 'lancamento_caixa'
                  and g.tgname = 'trg_bump_updated_at' and not g.tgisinternal)
union all
select 'índice do envio da loja',
       to_regclass(current_schema() || '.idx_lancamento_caixa_updated_at') is not null
union all
select 'nuvem: nenhum lançamento de venda sem caixa com o caixa no pedido',
       to_regclass(current_schema() || '.edge_status') is null
       or not exists (select 1 from lancamento_caixa l
                        join pedido_externo pe on pe.tenant_id = l.tenant_id and pe.comanda_id = l.comanda_id
                        join caixa_sessao s on s.id = pe.caixa_sessao_id and s.tenant_id = pe.tenant_id
                       where l.sessao_id is null and l.tipo = 'entrada' and l.categoria = 'venda');
