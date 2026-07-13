-- 084_empresa_distribuidor.sql — Marca a empresa como DISTRIBUIDOR (DMS/revenda).
-- Só quem tem is_distribuidor=true acessa o /frota (emitir licença/ativação,
-- gerir a frota). Cliente comum (presidente do próprio negócio) NÃO acessa.
-- Idempotente. Padrão false. Depois de aplicar, marque a SUA conta DMS:
--   update empresa set is_distribuidor = true where id = '<UUID_DA_SUA_EMPRESA_DMS>';

alter table empresa add column if not exists is_distribuidor boolean not null default false;
