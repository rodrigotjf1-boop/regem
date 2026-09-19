-- 271 — procedência da IMPORTAÇÃO de clientes (ex.: base exportada da Anota Aí).
-- NÃO é cloud-only: `cliente` existe e sincroniza com o servidor local.
--
-- O import de contatos grava clientes com origem = 'importado'. Faltava guardar DE ONDE e
-- EM QUE SEGMENTO a base de fora os classificava — é isso que vira público de campanha
-- ("ativos da Anota Aí", "inativos", "potenciais"). Formato:
--   { "fonte": "anotaai", "segmento": "ativo" | "inativo" | "potencial",
--     "pedidos": 12, "diasInatividade": 30, "importadoEm": "2026-09-19T..." }
-- Só preenchida em cliente NOVO criado pela importação — cliente que já existia no Regem
-- não é tocado (regra do lojista: importar não sobrescreve).
-- Aditiva e idempotente.
alter table cliente add column if not exists importacao jsonb;

create index if not exists idx_cliente_importacao_segmento
  on cliente (tenant_id, (importacao->>'fonte'), (importacao->>'segmento'))
  where importacao is not null;
