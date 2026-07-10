-- 073_cliente_telefone_obrigatorio.sql — Corrige a 072: o cliente do cardápio
-- SEMPRE é identificado por telefone (não há pedido anônimo). O token só evita
-- expor nome/telefone na URL. Um cliente tem 1:N endereços.
-- Remove eventuais clientes sem telefone (não devem existir) e volta o NOT NULL.

delete from cliente where telefone is null;
alter table cliente alter column telefone set not null;
