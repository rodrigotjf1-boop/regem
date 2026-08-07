-- 167_impressao_papel_multiplo.sql
-- Direcionamento de impressão: papel MÚLTIPLO por impressora.
-- Antes: `papel` era único ('cupom' | 'producao'), então uma impressora não podia
-- servir cupom E produção ao mesmo tempo — e o cupom do cliente nunca chegava numa
-- impressora marcada como 'producao' (caso da ELGIN i8 do caixa). Agora cada
-- impressora tem dois flags independentes. `papel` fica só por compatibilidade; o
-- roteamento (cupom via_cliente / produção por setor) passa a ler os flags.
-- Aditiva e idempotente. NÃO é @cloud-only (o edge também imprime e precisa dela).

alter table equipamento add column if not exists faz_cupom    boolean not null default false;
alter table equipamento add column if not exists faz_producao boolean not null default false;

-- Backfill a partir do papel atual (nada muda de comportamento após a migração):
update equipamento set faz_cupom = true
  where tipo = 'impressora' and papel = 'cupom' and faz_cupom = false;

update equipamento set faz_producao = true
  where tipo = 'impressora' and (papel = 'producao' or papel is null) and faz_producao = false;
