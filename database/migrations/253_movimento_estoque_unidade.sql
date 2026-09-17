-- 253_movimento_estoque_unidade.sql — Todo movimento de estoque passa a pertencer a uma LOJA.
--
-- ⚠️ NÃO é @cloud-only: o ledger é gravado no servidor local e na nuvem. Aplicar nos dois.
-- ⚠️ ADICIONA COLUNA em `movimento_estoque` — há `select()` completo nela no código
--    (estorno de venda): sem esta migration na nuvem ANTES do merge, dá 42703.
--
-- POR QUÊ — decisão do dono (separação total por loja)
-- Cada loja é uma unidade física diferente, com o próprio estoque, as próprias métricas e
-- o próprio CMV; a loja é escolhida no login justamente para separar as unidades por
-- completo, e o presidente decide olhando loja por loja. O cadastro do insumo pode ser
-- compartilhado entre lojas, mas o controle é de cada uma.
--
-- `movimento_estoque` NÃO tinha unidade. O saldo é a soma do ledger por insumo, então,
-- quando o mesmo insumo servia duas lojas, as duas DIVIDIAM um saldo só: a venda de uma
-- baixava o estoque "da outra", e a contagem de uma corrigia a outra.
--
-- Esta migration só GRAVA a loja. As leituras continuam como estão até a fase seguinte —
-- o sistema se comporta igual a hoje, e o que for lançado a partir daqui já nasce certo.
--
-- COMO A LOJA É DESCOBERTA — uma função, usada pelo gatilho e pelo preenchimento do
-- histórico (mig 254), para existir UMA definição só:
--   1. a ORIGEM do movimento (`ref_tipo` + `ref_id`): comanda, lista de compras, nota,
--      desperdício, contagem ou ordem de produção — todas têm loja;
--   2. sem origem que responda: a loja do INSUMO, quando ele é exclusivo de uma loja;
--   3. empresa com uma loja só: essa loja;
--   4. senão fica nulo — não se atribui loja por palpite (decisão do dono); o saldo é
--      restabelecido na próxima contagem daquela loja.
--
-- POR QUE UM GATILHO, E NÃO SÓ O CÓDIGO
-- Até o `.zip` chegar às lojas, o servidor local continua gravando movimento SEM loja e o
-- envia para a nuvem assim. Com a resolução só no código, esses movimentos chegariam sem
-- loja durante toda a janela de atualização; com o gatilho, a nuvem resolve a loja deles
-- no momento em que chegam. O código continua passando a loja EXPLÍCITA quando a sabe
-- melhor que a origem (ajuste manual e produção manual) — o gatilho só preenche o que
-- vier vazio.

alter table movimento_estoque add column if not exists unidade_id uuid;

create or replace function regem_unidade_do_movimento(
  p_tenant uuid, p_item uuid, p_ref_tipo text, p_ref uuid
) returns uuid
language plpgsql stable as $$
declare
  v uuid;
begin
  -- 1. origem
  if p_ref is not null then
    v := case p_ref_tipo
      when 'venda'   then (select unidade_id from comanda where id = p_ref)
      when 'estorno' then (select unidade_id from comanda where id = p_ref)
      when 'compra_item' then (
        select l.unidade_id from compra_item ci
          join compra_lista l on l.id = ci.lista_id
         where ci.id = p_ref)
      when 'recebimento_item' then (
        select r.unidade_id from recebimento_item ri
          join recebimento r on r.id = ri.recebimento_id
         where ri.id = p_ref)
      when 'desperdicio' then (select unidade_id from desperdicio where id = p_ref)
      when 'contagem_item' then (
        select cl.unidade_id from contagem_item ci
          join contagem_execucao ce on ce.id = ci.execucao_id
          join contagem_lista cl on cl.id = ce.lista_id
         where ci.id = p_ref)
      when 'producao' then (select unidade_id from ordem_producao where id = p_ref)
    end;
  end if;
  -- 2. insumo exclusivo de uma loja
  if v is null then
    select unidade_id into v from item_estoque where id = p_item;
  end if;
  -- 3. empresa de uma loja só
  if v is null then
    select case when count(*) = 1 then min(id::text)::uuid end into v
      from unidade where tenant_id = p_tenant and deleted_at is null;
  end if;
  return v;
end $$;

create or replace function regem_movimento_estoque_unidade() returns trigger
language plpgsql as $$
begin
  if new.unidade_id is null then
    new.unidade_id := regem_unidade_do_movimento(new.tenant_id, new.item_id, new.ref_tipo, new.ref_id);
  end if;
  return new;
end $$;

drop trigger if exists trg_movimento_estoque_unidade on movimento_estoque;
create trigger trg_movimento_estoque_unidade
  before insert on movimento_estoque
  for each row execute function regem_movimento_estoque_unidade();
