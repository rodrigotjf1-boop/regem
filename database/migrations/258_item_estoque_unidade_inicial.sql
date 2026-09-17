-- 258_item_estoque_unidade_inicial.sql — Valores iniciais de cada loja: o que vale hoje.
--
-- ⚠️ NÃO é @cloud-only. Aplicar DEPOIS da 257 e ANTES do merge, na nuvem e no edge.
-- Uma instrução só; pode ser rodada de novo (não sobrescreve o que a loja já tem).
--
-- O QUE FAZ
-- Em empresa com MAIS DE UMA loja, cria para cada insumo, em cada loja que o usa (a dele,
-- ou as duas se o cadastro é compartilhado), uma linha com o custo médio, o estoque mínimo
-- e os dias de segurança que o insumo tem hoje. Daqui em diante cada loja segue o seu:
-- a primeira compra da loja A pondera o custo da A, sem tocar no da B.
--
-- POR QUE O CUSTO DE HOJE E NÃO O HISTÓRICO REFEITO (decisão: opção A)
-- Refazer a média ponderada de cada loja pelas entradas antigas exigiria custo em toda
-- entrada, e não existe: carga inicial não tem custo nenhum e parte dos recebimentos também.
-- O recálculo sairia errado e diferente do custo que o dono vê hoje, sem aviso. O custo
-- atual é o único confiável — a mesma lógica da 256, que preservou o custo do dia. É também
-- como sistemas com custo médio por filial começam quando a separação é ligada.
--
-- Empresa de uma loja só não ganha linha: continua no cadastro do insumo.

insert into item_estoque_unidade
  (id, tenant_id, item_id, unidade_id, custo_medio, estoque_minimo, dias_seguranca)
select md5(i.id::text || un.id::text)::uuid, i.tenant_id, i.id, un.id,
       i.custo_medio, i.estoque_minimo, i.dias_seguranca
  from item_estoque i
  join unidade un on un.tenant_id = i.tenant_id and un.deleted_at is null
                 and (i.unidade_id is null or un.id = i.unidade_id)
 where i.deleted_at is null
   and (select count(*) from unidade u2
         where u2.tenant_id = i.tenant_id and u2.deleted_at is null) > 1
on conflict (id) do nothing;
