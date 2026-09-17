-- 261_produto_pausa_estoque_inicial.sql — Estado inicial da pausa por loja: o que vale hoje.
--
-- ⚠️ NÃO é @cloud-only. Aplicar DEPOIS da 260 e ANTES do merge, na nuvem e no edge.
-- Uma instrução só; pode ser rodada de novo (não sobrescreve linha que já existe).
--
-- Produto pausado hoje (pelo saldo somado da empresa) começa pausado em cada loja da empresa.
-- É o mesmo estado que o cliente vê agora — nada muda no ar ao aplicar. Na próxima baixa ou
-- entrada de estoque de cada loja, a pausa daquela loja é recalculada com o saldo DELA e o
-- produto volta sozinho onde houver insumo.

insert into produto_pausa_estoque (id, tenant_id, produto_id, unidade_id, pausado, motivo)
select md5(p.id::text || un.id::text)::uuid, p.tenant_id, p.id, un.id, true, p.pausa_motivo
  from produto p
  join unidade un on un.tenant_id = p.tenant_id and un.deleted_at is null
 where p.deleted_at is null
   and p.pausado_estoque = true
on conflict (id) do nothing;
