-- L-VEN-1: CPF opcional na comanda (nota do consumidor em venda de totem/externa).
-- Aditiva e idempotente. O CPF é armazenado no cupom; a inclusão no destinatário
-- da NFC-e é tratada no fluxo fiscal (follow-up L-VEN-CPF).
alter table comanda add column if not exists cpf text;
