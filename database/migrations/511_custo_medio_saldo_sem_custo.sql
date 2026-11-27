-- @cloud-only
-- 511 — ERR-630: o custo médio com o saldo contado SEM custo (decisão do dono, 27/11/2026).
--
-- O estoque carregado em 25/11/2026 entrou pela contagem, sem custo, e pesava como R$ 0 no custo médio ponderado: a primeira
-- compra de cada insumo derrubou o custo (o blend comprado a R$ 31,99 ficou R$ 19,10) e o CMV saía baixo. A regra nova
-- (`custoMedioPonderado`): custo médio 0 com saldo = custo DESCONHECIDO, e a entrada com custo vale sozinha.
--
-- Esta migration refaz o custo pela regra nova, insumo a insumo, a partir do ledger (movimento_estoque, em ordem). Só mexe no
-- insumo cujo custo de HOJE ela reproduz pela regra antiga (prova de que o custo veio do ledger, e não da importação ou de outro
-- lugar); o resto fica como está. Na entrada da nota da Rucas corrigida pela 510, vale a quantidade e o custo corrigidos.
-- Só empresa de uma loja (o custo é o do cadastro). Rodar de novo não muda nada (o custo de hoje já não bate com a regra antiga).
-- Só da nuvem: a loja recebe o custo pelo sync (item_estoque, pelo updated_at).

set local lock_timeout = '5s';

do $$
declare
  x record;
  v_hoje numeric;
  v_depois numeric;
  v_n int;
  v_feitos int := 0;
begin
  for x in
    with recursive mov as (
      select m.item_id, m.tenant_id, m.tipo::text as tipo, m.quantidade::numeric as q,
             row_number() over (partition by m.item_id order by m.created_at, m.id) as n,
             (case when m.tipo = 'entrada' then
                case when exists (select 1 from movimento_estoque c where c.ref_tipo = 'correcao_nota' and c.ref_id = m.id)
                     then (select ci.custo_unitario from compra_item ci where ci.id = m.ref_id)
                     else m.custo_unitario end
              end)::numeric as custo,
             (m.quantidade + coalesce((select sum(c.quantidade) from movimento_estoque c where c.ref_tipo = 'correcao_nota' and c.ref_id = m.id), 0))::numeric as q_ef
        from movimento_estoque m
        join item_estoque i on i.id = m.item_id and i.tenant_id = m.tenant_id and i.deleted_at is null
       where m.item_id in (select item_id from movimento_estoque where tipo = 'entrada' and custo_unitario is not null)
         and (select count(*) from unidade u where u.tenant_id = m.tenant_id and u.deleted_at is null) <= 1
    ),
    r as (
      select item_id, tenant_id, n,
             (case tipo when 'entrada' then q when 'saida' then -q else q end) as saldo,
             (case when tipo = 'entrada' and custo is not null then custo else 0::numeric end) as cm_antigo,
             (case when tipo = 'entrada' and custo is not null then custo else 0::numeric end) as cm_novo
        from mov where n = 1
      union all
      select m.item_id, m.tenant_id, m.n,
             r.saldo + (case m.tipo when 'entrada' then m.q when 'saida' then -m.q else m.q end),
             case when m.tipo = 'entrada' and m.custo is not null then
               case when greatest(r.saldo, 0) + m.q_ef <= 0 then m.custo
                    else (greatest(r.saldo, 0) * r.cm_antigo + m.q_ef * m.custo) / (greatest(r.saldo, 0) + m.q_ef) end
             else r.cm_antigo end,
             case when m.tipo = 'entrada' and m.custo is not null then
               case when not (r.cm_novo > 0) or greatest(r.saldo, 0) + m.q_ef <= 0 then m.custo
                    else (greatest(r.saldo, 0) * r.cm_novo + m.q_ef * m.custo) / (greatest(r.saldo, 0) + m.q_ef) end
             else r.cm_novo end
        from r join mov m on m.item_id = r.item_id and m.n = r.n + 1
    )
    select distinct on (item_id) item_id, tenant_id, cm_antigo, cm_novo from r order by item_id, n desc
  loop
    -- O insumo travado, como no recebimento: uma entrada ao mesmo tempo espera.
    select coalesce(custo_medio, 0) into v_hoje from item_estoque where id = x.item_id and tenant_id = x.tenant_id for no key update;
    -- Só o custo que veio do ledger (a regra antiga o reproduz) e que muda com a regra nova.
    continue when abs(x.cm_antigo - v_hoje) > 0.005 + 0.002 * v_hoje;
    continue when abs(x.cm_novo - v_hoje) <= 0.0001;
    update item_estoque set custo_medio = round(x.cm_novo, 6), updated_at = now() where id = x.item_id and tenant_id = x.tenant_id;
    get diagnostics v_n = row_count;
    -- A conferência no MESMO Run: a linha mudou e ficou com o custo da regra nova. Senão, nada desta migration fica.
    select custo_medio into v_depois from item_estoque where id = x.item_id;
    if v_n <> 1 or v_depois <> round(x.cm_novo, 6) then
      raise exception 'ERR-630: o custo do insumo % não ficou como a regra nova (%, ficou %)', x.item_id, round(x.cm_novo, 6), v_depois;
    end if;
    v_feitos := v_feitos + 1;
  end loop;
  raise notice 'ERR-630: % insumos com o custo médio refeito pela regra nova', v_feitos;
end $$;
