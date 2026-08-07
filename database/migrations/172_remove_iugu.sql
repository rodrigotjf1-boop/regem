-- 172_remove_iugu.sql
-- @cloud-only
-- Remoção da integração Iugu (PIX). O código do gateway Iugu foi retirado
-- (fica só o Mercado Pago). Limpa as credenciais/config do canal 'iugu' das lojas
-- — inertes sem o código. Idempotente. Não mexe no histórico de pedidos.

delete from integracao where canal = 'iugu';
