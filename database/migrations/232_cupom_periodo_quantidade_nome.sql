-- 232_cupom_periodo_quantidade_nome.sql — cupom: janela de validade (início), limite
-- GLOBAL de usos e nome amigável. Antes só existia `validade` (data-FIM) e max_por_cliente.
-- Aditivo/idempotente. (No edge, se a tabela cupom não existir, o runner pula 42P01.)

alter table cupom add column if not exists valido_de date;    -- início da validade (o `validade` continua sendo o FIM)
alter table cupom add column if not exists max_usos integer;  -- limite GLOBAL de usos (null = ilimitado)
alter table cupom add column if not exists nome text;         -- nome amigável do cupom (label vira "Nome / Código")
