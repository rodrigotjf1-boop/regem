-- 256_estoque_snapshot_por_loja_historico.sql — Reconstrói POR LOJA os snapshots que já existem.
--
-- ⚠️ NÃO é @cloud-only. Aplicar DEPOIS da 255 e ANTES do merge, na nuvem e no edge.
-- ⚠️ Rodar o ARQUIVO INTEIRO (as duas instruções, nesta ordem).
--
-- SEM ESTA MIGRATION O CMV DOBRA: os snapshots antigos têm a loja do insumo (nula para
-- insumo compartilhado) e os novos a loja do movimento; na mesma data, os dois somariam.
--
-- O QUE FAZ
-- Para cada (empresa, insumo, dia) que já tinha snapshot:
--   • QUANTIDADE — recontada pelo ledger, separada por loja (a loja do movimento, mig 253/254);
--   • CUSTO — o que estava gravado naquele dia. O custo médio do snapshot é o custo da data
--     em que foi tirado; recalcular com o custo de hoje mudaria o CMV de períodos já
--     fechados. Um insumo compartilhado dividido em duas lojas recebe, nas duas, o custo que
--     se conhecia naquele dia — o único que existia.
-- Um insumo compartilhado gera uma linha por loja; um exclusivo, só na loja dele; empresa
-- sem loja cadastrada fica com a linha sem loja, como antes.
--
-- Movimento que ficou SEM loja na 254 (antigo, sem origem, insumo compartilhado em empresa
-- de duas lojas) não entra em loja nenhuma — decisão do dono: não se atribui por palpite;
-- a próxima contagem daquela loja restabelece o saldo.
--
-- POR QUE DUAS INSTRUÇÕES SOLTAS (e não tabela temporária)
-- A primeira versão guardava os snapshots antigos numa tabela temporária. O SQL Editor do
-- Supabase não roda o arquivo numa sessão só: a tabela nascia numa conexão e o DELETE rodava
-- noutra (42P01 "_snapshot_antigo does not exist"). Também não dá para juntar tudo numa
-- instrução com CTE de DELETE: a ordem entre o DELETE da CTE e o INSERT principal não é
-- garantida, e o INSERT poderia ser descartado pelo conflito com a linha que ia ser apagada.
-- Por isso: (1) GRAVA as linhas por loja — nada é apagado; (2) só então APAGA as linhas que
-- não são mais válidas. Cada instrução é segura sozinha e as duas podem ser rodadas de novo.

-- 1) Linhas por loja. O custo vem do snapshot que já existia naquele dia; a quantidade é
--    recontada. Se a linha já existe (insumo exclusivo, ou empresa sem loja), só a
--    quantidade é atualizada — o custo daquele dia fica.
insert into estoque_snapshot (tenant_id, unidade_id, item_id, data, saldo, custo_medio)
select a.tenant_id, u.uid, a.item_id, a.data,
       coalesce((
         select sum(case m.tipo when 'entrada' then m.quantidade
                                when 'saida'   then -m.quantidade
                                else m.quantidade end)
           from movimento_estoque m
          where m.item_id = a.item_id
            and m.data <= a.data
            and m.unidade_id is not distinct from u.uid
       ), 0),
       a.custo_medio
  from (
    select tenant_id, item_id, data, max(custo_medio) as custo_medio
      from estoque_snapshot
     group by tenant_id, item_id, data
  ) a
  join item_estoque i on i.id = a.item_id
  cross join lateral (
    select un.id as uid
      from unidade un
     where un.tenant_id = a.tenant_id and un.deleted_at is null
       and (i.unidade_id is null or un.id = i.unidade_id)
    union all
    select null::uuid
     where not exists (
       select 1 from unidade un2 where un2.tenant_id = a.tenant_id and un2.deleted_at is null
     )
  ) u
on conflict (tenant_id, coalesce(unidade_id, '00000000-0000-0000-0000-000000000000'::uuid), item_id, data)
  do update set saldo = excluded.saldo;

-- 2) Apaga o que não pertence a loja válida: a linha antiga sem loja de empresa que TEM loja
--    (é ela que dobraria o CMV), e linha de loja que não usa aquele insumo. Snapshot de
--    insumo que não existe mais fica como está (não foi reconstruído).
delete from estoque_snapshot s
 using item_estoque i
 where i.id = s.item_id
   and not (
     (s.unidade_id is null
       and not exists (select 1 from unidade un where un.tenant_id = s.tenant_id and un.deleted_at is null))
     or
     (s.unidade_id is not null
       and exists (select 1 from unidade un where un.id = s.unidade_id and un.tenant_id = s.tenant_id and un.deleted_at is null)
       and (i.unidade_id is null or i.unidade_id = s.unidade_id))
   );
