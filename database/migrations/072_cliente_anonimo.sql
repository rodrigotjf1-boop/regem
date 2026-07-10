-- 072_cliente_anonimo.sql — Cliente do cardápio identificado por TOKEN aleatório
-- (não exige nome/telefone). O cliente é criado no 1º pedido e o token assinado
-- fica no navegador. Nome/telefone passam a ser opcionais (para entrega).
-- Idempotente.

alter table cliente alter column telefone drop not null;
