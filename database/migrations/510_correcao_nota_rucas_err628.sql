-- @cloud-only
-- 510 — ERR-628: a correção da nota da Rucas lançada pelo Mister em 27/11/2026, 00:54.
--
-- A nota deu entrada em 5 insumos com a conta da embalagem errada: o "UN" do fornecedor foi contado como peça solta ou a
-- conversa gravou o que vem DENTRO da caixa como a quantidade de caixas. O valor total de cada linha está certo; a quantidade
-- e, por isso, o custo médio não:
--   Ovo          entraram 360 caixas  → 1 caixa      (1 caixa = 30 dúzias)        R$ 165,99 a caixa
--   Blend 150gr  entraram 240 pacotes → 40 pacotes   (1 pacote = 6 discos)        R$ 31,99 o pacote
--   Queijo       entraram 4.416 peças → 24 peças     (1 caixa = 8 peças)          R$ 92,49 a peça
--   Bacon        entraram 48 caixas   → 48 kg = 5,3333 caixas (1 caixa = 9 kg)   R$ 368,91 a caixa
--   Guaravita    entraram 600 caixas  → 25 caixas    (1 caixa = 24 copos)         R$ 23,49 a caixa
--
-- Como corrige (sem apagar nem mudar o que foi lançado):
--   · um AJUSTE com a diferença (negativo), como o "Ajuste" de Estoque › Produtos — linha NOVA, que desce ao servidor da loja
--     pelo sync (o movimento só viaja como linha nova); não conta como compra nem como consumo. O id é fixo: rodar de novo não
--     lança outra vez;
--   · o custo médio recalculado pela MESMA conta do recebimento (`custoMedioPonderado`: o saldo antes da entrada, o custo de
--     antes e a entrada certa) — só se nenhuma outra entrada veio depois;
--   · o recebido do pedido (compra_item) com a quantidade e o custo certos;
--   · a memória do fornecedor (mister_de_para) com a conta certa, para a próxima nota da Rucas.
-- Só age no lançamento exatamente como ele foi gravado (o id, "entrada", a quantidade errada). Só da nuvem: a loja recebe o
-- ajuste, o custo e o pedido pelo sync.

set local lock_timeout = '5s';

do $$
declare
  r record;
  m record;
  v_correcao uuid;
  v_lojas int;
  v_saldo_antes numeric;
  v_custo_atual numeric;
  v_custo_antes numeric;
  v_novo numeric;
begin
  for r in
    select * from (values
      ('1707f0dc-b243-4fd2-be86-4d8a8d4d90df'::uuid, 360::numeric,  1::numeric,                 165.99::numeric,                 360::numeric,  1::numeric),
      ('69223773-6eb3-4fbd-b7c8-e7bb9ef7324e'::uuid, 240::numeric,  40::numeric,                31.99::numeric,                  6::numeric,    1::numeric),
      ('98472980-d267-4fb5-b659-5f50c74d018e'::uuid, 4416::numeric, 24::numeric,                92.49::numeric,                  1472::numeric, 8::numeric),
      ('63b39197-babf-4e99-9f9d-a799115457af'::uuid, 48::numeric,   (48::numeric / 9),          round(1967.52::numeric * 9 / 48, 4), 1::numeric, (1::numeric / 9)),
      ('e7725689-ca7e-4781-9b07-4e0b38d2ca06'::uuid, 600::numeric,  25::numeric,                23.49::numeric,                  24::numeric,   1::numeric)
    ) as t(mov_id, errada, certa, custo_certo, fator_errado, fator_certo)
  loop
    select id, tenant_id, unidade_id, item_id, data, created_at, ref_id
      into m
      from movimento_estoque
     where id = r.mov_id and tipo = 'entrada' and quantidade = r.errada;
    if not found then
      continue; -- outro banco, ou o lançamento já não está como foi gravado
    end if;

    v_correcao := md5('err628:' || r.mov_id::text)::uuid;
    if exists (select 1 from movimento_estoque where id = v_correcao) then
      continue; -- já corrigido
    end if;
    -- Alguém já ajustou ou contou o insumo depois da entrada (Estoque › Produtos › Ajuste, a Contagem): o saldo já foi acertado
    -- à mão, e a diferença lançada aqui contaria a correção duas vezes.
    if exists (
      select 1 from movimento_estoque x
       where x.tenant_id = m.tenant_id and x.item_id = m.item_id and x.tipo = 'ajuste' and x.created_at > m.created_at
    ) then
      raise notice 'ERR-628: o insumo % foi ajustado depois da entrada — não corrijo por cima', m.item_id;
      continue;
    end if;

    -- O insumo travado, como no recebimento (`travarInsumos`): a venda não espera (a chave estrangeira do movimento é key share).
    perform 1 from item_estoque where id = m.item_id and tenant_id = m.tenant_id for no key update;

    insert into movimento_estoque (id, tenant_id, unidade_id, item_id, tipo, quantidade, motivo, data, ref_tipo, ref_id)
    values (v_correcao, m.tenant_id, m.unidade_id, m.item_id, 'ajuste', -(r.errada - r.certa),
            'Correção da nota da Rucas de 27/11 (ERR-628): a entrada contou a embalagem errada', m.data, 'correcao_nota', r.mov_id);

    -- O custo médio pela conta do recebimento, com a entrada certa. Só numa loja (o custo é o do cadastro) e sem outra entrada depois.
    select count(*) into v_lojas from unidade where tenant_id = m.tenant_id and deleted_at is null;
    if v_lojas <= 1 and not exists (
      select 1 from movimento_estoque x
       where x.tenant_id = m.tenant_id and x.item_id = m.item_id and x.tipo = 'entrada' and x.created_at > m.created_at
    ) then
      select coalesce(sum(case tipo when 'entrada' then quantidade when 'saida' then -quantidade else quantidade end), 0)
        into v_saldo_antes
        from movimento_estoque
       where tenant_id = m.tenant_id and item_id = m.item_id and created_at < m.created_at;
      v_saldo_antes := greatest(v_saldo_antes, 0);
      select coalesce(custo_medio, 0) into v_custo_atual from item_estoque where id = m.item_id;
      -- O custo de ANTES da entrada, desfeito da conta que o recebimento gravou: atual = (antes·saldo + errada·custo_errado) / (saldo + errada).
      if v_saldo_antes > 0 then
        v_custo_antes := greatest(((v_custo_atual * (v_saldo_antes + r.errada)) - (r.errada * (select custo_unitario from movimento_estoque where id = r.mov_id))) / v_saldo_antes, 0);
        if v_custo_antes < 0.01 then v_custo_antes := 0; end if;
      else
        v_custo_antes := 0;
      end if;
      v_novo := (v_saldo_antes * v_custo_antes + r.certa * r.custo_certo) / (v_saldo_antes + r.certa);
      update item_estoque set custo_medio = round(v_novo, 6), updated_at = now() where id = m.item_id and tenant_id = m.tenant_id;
    else
      raise notice 'ERR-628: custo médio do insumo % não recalculado (mais de uma loja ou outra entrada depois)', m.item_id;
    end if;

    -- O recebido do pedido: a quantidade e o custo certos (o item "a mais" que entrou no pedido também na quantidade pedida).
    update compra_item
       set qtd_recebida = r.certa,
           custo_unitario = r.custo_certo,
           quantidade = case when quantidade = r.errada then r.certa else quantidade end,
           updated_at = now()
     where id = m.ref_id and tenant_id = m.tenant_id and qtd_recebida = r.errada;

    -- A memória do fornecedor: a conta certa para a próxima nota.
    if to_regclass('mister_de_para') is not null then
      update mister_de_para
         set fator = r.fator_certo, atualizado_em = now()
       where tenant_id = m.tenant_id and item_id = m.item_id and fator = r.fator_errado;
    end if;
  end loop;
end $$;
