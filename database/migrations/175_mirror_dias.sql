-- 175_mirror_dias.sql — janela (em dias) que o SERVIDOR LOCAL (edge) puxa das
-- tabelas TRANSACIONAIS pesadas da nuvem no sync espelhado (ver docs/sync-espelho-e-modos.md).
--
-- NÃO é @cloud-only, de propósito: a coluna vive em `empresa` (tabela que existe
-- tanto na nuvem quanto no edge). A NUVEM lê o valor no GET /sync/pull para limitar
-- o período das transacionais que descem; a nuvem em si mantém histórico INTEGRAL.
-- Configurável no menu Financeiro (presidente/C&O). Default 60 dias.
alter table empresa add column if not exists mirror_dias smallint not null default 60;
