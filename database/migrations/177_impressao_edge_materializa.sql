-- 177_impressao_edge_materializa.sql — S3 (impressão nuvem→edge do sync espelhado).
-- Vendas registradas no MODO NUVEM (presidente) descem (S1) mas não imprimem: a
-- impressora do caixa é LOCAL e a nuvem não a alcança. O worker do edge imprime a
-- tabela `impressao_job` (edge-local). Aqui damos ao materializador do edge o que
-- ele precisa para (a) ligar cada job à comanda e (b) não reimprimir a mesma venda.
--
-- NÃO é @cloud-only: `impressao_job` existe no edge; a coluna e a tabela-marcador
-- precisam existir lá. Na nuvem ficam presentes e inertes (o worker só roda no edge).

-- Liga o job de impressão à comanda de origem (idempotência do materializador +
-- reimpressão por comanda). Vendas locais já gravam; as que descem, o edge preenche.
alter table impressao_job add column if not exists comanda_id uuid;
create index if not exists idx_impressao_job_comanda on impressao_job (comanda_id);

-- Marcador edge-local: comandas que o materializador já processou (mesmo sem
-- impressora configurada), para não reprocessar a cada ciclo. NÃO entra no sync.
create table if not exists impressao_edge_feito (
  comanda_id uuid primary key,
  criado_em timestamptz not null default now()
);
