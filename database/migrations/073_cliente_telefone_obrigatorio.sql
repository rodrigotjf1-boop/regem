-- 073_cliente_telefone_obrigatorio.sql — Corrige a 072: o cliente do cardápio
-- SEMPRE é identificado por telefone (não há pedido anônimo). O token só evita
-- expor nome/telefone na URL. Um cliente tem 1:N endereços.
--
-- ⚠️ EDGE-SAFE (set/2026): antes fazia `delete from cliente where telefone is null`,
-- que DERRUBAVA o update do edge — um cliente sem telefone pode estar REFERENCIADO
-- (pedido_externo/cliente_endereco) → o DELETE bate FK (23503,
-- pedido_externo_cliente_id_fkey) e aborta a migration inteira (rollback do update).
-- Deletar também DESTRUIRIA o pedido. Em vez de deletar, faz BACKFILL de um telefone
-- placeholder ÚNICO por id (não colide com unique) e MANTÉM o cliente; depois o NOT NULL.
update cliente
   set telefone = 'S/N-' || left(replace(id::text, '-', ''), 10)
 where telefone is null;
alter table cliente alter column telefone set not null;
