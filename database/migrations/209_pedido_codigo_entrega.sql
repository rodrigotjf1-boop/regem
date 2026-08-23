-- @cloud-only
-- 209_pedido_codigo_entrega.sql — Fase 5 do app do entregador (cloud-only).
-- Código ALEATÓRIO de 4 dígitos para confirmar a entrega PRÓPRIA (cardápio/local) — NÃO
-- os últimos 4 do telefone (o entregador tem acesso ao número). O cliente informa o
-- código no ato da entrega e o entregador só conclui após digitá-lo. Nasce com a linha
-- (default) → estável e sincroniza sem corrida (mesma lição do despacho_token, mig 206).
-- Cloud-only: o módulo entregador é @CloudOnly e os pedidos de delivery nascem na nuvem
-- (cardápio/marketplace); o sync ignora a coluna no edge. Marketplaces com código próprio
-- (iFood/99food) continuam validando pela API deles — este código é só p/ entrega própria.
-- Aditiva e idempotente.

alter table pedido_externo add column if not exists codigo_entrega text;

alter table pedido_externo
  alter column codigo_entrega set default lpad((floor(random() * 10000))::int::text, 4, '0');

-- Backfill dos pedidos de ENTREGA ainda ativos (retirada não tem código de entregador).
update pedido_externo
  set codigo_entrega = lpad((floor(random() * 10000))::int::text, 4, '0')
  where codigo_entrega is null
    and tipo <> 'retirada'
    and status not in ('concluido', 'cancelado');
