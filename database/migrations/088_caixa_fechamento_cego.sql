-- Fechamento de caixa CEGO por forma de pagamento + limite de diferença por unidade.
-- O operador informa o contado por forma sem ver o esperado; guardamos o contado,
-- o esperado e a diferença por forma (jsonb) para o comparativo e o relatório.
alter table caixa_sessao add column if not exists valores_informados jsonb;   -- {dinheiro, cartao, pix, ...}
alter table caixa_sessao add column if not exists esperado_por_forma jsonb;
alter table caixa_sessao add column if not exists diferenca_por_forma jsonb;

-- Limite de diferença que dispara ocorrência automática (padrão R$ 5,00), por unidade.
alter table unidade add column if not exists limite_diferenca_caixa numeric not null default '5';
