-- @cloud-only
-- 320 — Linhas de sub-receita gravadas sem conversão de quilo/grama e litro/ml (ERR-229).
--
-- Até a mig 319, a linha de uma ficha que usa outra como sub-receita guardava a quantidade COMO A PESSOA
-- DIGITOU, e a unidade era só rótulo: a venda, a produção e o custo leem a quantidade na unidade em que
-- a sub-receita RENDE. "35 grama" de uma cebola ao molho que rende 1 kg contava 35 kg — mil vezes mais
-- no custo e na baixa. Visto na produção em 14/10/2026 (3 linhas). O dono autorizou a correção:
-- "Pode corrigir".
--
-- O que muda: só a linha VIVA de sub-receita cuja unidade e a do rendimento da sub-receita são medidas
-- da mesma família com tamanhos diferentes (grama × kg, ml × litro). A quantidade vai para a unidade do
-- rendimento e a linha passa a mostrar essa unidade: "35 grama" vira "0,035 kg" — a mesma coisa, agora
-- contada certo (na tela nova a pessoa pode voltar a ver em grama). Linha em unidade que não se
-- converte sozinha ("1 porção" de um molho que rende em saco) NÃO é tocada: depende de a pessoa
-- cadastrar a conversão na sub-receita.
--
-- SÓ NUVEM: a linha desce para o servidor da loja pelo sincronismo (o gatilho da mig 242 renova o
-- `updated_at`). Rodar também na loja converteria de novo a linha que já desceu convertida.
-- Idempotente: a linha corrigida passa a ter a unidade do rendimento e não casa mais com a regra.
-- Não apaga nada.
set local lock_timeout = '5s';

with medida(chave, familia, base) as (
  values ('kg', 'massa', 1000::numeric), ('k', 'massa', 1000), ('kilo', 'massa', 1000), ('quilo', 'massa', 1000),
         ('kilograma', 'massa', 1000), ('quilograma', 'massa', 1000),
         ('grama', 'massa', 1), ('g', 'massa', 1), ('gr', 'massa', 1),
         ('litro', 'volume', 1000), ('l', 'volume', 1000), ('ml', 'volume', 1), ('mililitro', 'volume', 1)
),
nomes as (
  -- O nome para comparar, como `chaveUnidade` no servidor: minúsculo, sem espaço nas pontas e sem o
  -- "s" do plural ("Gramas" = "grama").
  select fi.id, f.rendimento_unidade,
         case when length(u) > 2 and u like '%s' and u not like '%ss' then left(u, -1) else u end as chave_linha,
         case when length(s) > 2 and s like '%s' and s not like '%ss' then left(s, -1) else s end as chave_sub
    from ficha_ingrediente fi
    join ficha_tecnica f on f.id = fi.sub_ficha_id and f.tenant_id = fi.tenant_id
    cross join lateral (select lower(btrim(coalesce(fi.unidade, ''))) as u,
                               lower(btrim(coalesce(f.rendimento_unidade, ''))) as s) b
   where fi.deleted_at is null and fi.sub_ficha_id is not null
),
alvo as (
  select n.id, n.rendimento_unidade, ml.base as base_linha, ms.base as base_sub
    from nomes n
    join medida ml on ml.chave = n.chave_linha
    join medida ms on ms.chave = n.chave_sub and ms.familia = ml.familia
   where ml.base <> ms.base
)
update ficha_ingrediente fi
   set quantidade = trim_scale(round(fi.quantidade * a.base_linha / a.base_sub, 15)),
       unidade = a.rendimento_unidade
  from alvo a
 where fi.id = a.id;

-- Conferência no MESMO Run: nenhuma linha viva de sub-receita pode ter sobrado com grama × kg ou
-- ml × litro (`ok = true`).
with medida(chave, familia, base) as (
  values ('kg', 'massa', 1000::numeric), ('k', 'massa', 1000), ('kilo', 'massa', 1000), ('quilo', 'massa', 1000),
         ('kilograma', 'massa', 1000), ('quilograma', 'massa', 1000),
         ('grama', 'massa', 1), ('g', 'massa', 1), ('gr', 'massa', 1),
         ('litro', 'volume', 1000), ('l', 'volume', 1000), ('ml', 'volume', 1), ('mililitro', 'volume', 1)
),
nomes as (
  select case when length(u) > 2 and u like '%s' and u not like '%ss' then left(u, -1) else u end as chave_linha,
         case when length(s) > 2 and s like '%s' and s not like '%ss' then left(s, -1) else s end as chave_sub
    from ficha_ingrediente fi
    join ficha_tecnica f on f.id = fi.sub_ficha_id and f.tenant_id = fi.tenant_id
    cross join lateral (select lower(btrim(coalesce(fi.unidade, ''))) as u,
                               lower(btrim(coalesce(f.rendimento_unidade, ''))) as s) b
   where fi.deleted_at is null and fi.sub_ficha_id is not null
)
select 'linhas de sub-receita em grama × kg ou ml × litro' as objeto,
       count(*) = 0 as ok
  from nomes n
  join medida ml on ml.chave = n.chave_linha
  join medida ms on ms.chave = n.chave_sub and ms.familia = ml.familia
 where ml.base <> ms.base;
