-- @cloud-only
-- 425_integracao_clique_empresa.sql — a autorização por clique para a EMPRESA INTEIRA (Hub DMS, F6, plano "Clique
-- RegemCast → Regem", 15/11/2026; protótipo `prototipos/clique-empresa-inteira.html` do hub, aprovado de antemão).
--
-- O RegemCast lê os clientes e as compras da empresa toda (o acesso SEM loja da mig 302). Pelo clique, a troca do código
-- entrega UMA ligação sem loja e troca, na mesma transação, o acesso ativo da empresa com o aplicativo.
--
-- O QUE ENTRA
--   Um índice único: UM acesso ativo do clique por empresa e aplicativo quando o acesso é da empresa inteira. O índice da
--   mig 336 (`uq_integracao_token_loja_clique_ativo`, por empresa, loja e aplicativo) não pega este caso: no índice único
--   do Postgres, duas linhas com a loja vazia (nula) contam como diferentes. Duas trocas da mesma empresa ao mesmo tempo:
--   uma leva, a outra recebe 23505 e responde "outra autorização desta empresa terminou agora mesmo" (V24).
--
-- O QUE NÃO MUDA
--   Nenhuma tabela, coluna, restrição ou gatilho. Os escopos do RegemCast (`clientes.ler`, `vendas.99food.ler`) já estão
--   nas travas de escopo do token e da autorização desde a 302/398. Nenhum acesso existente entra no índice (nenhum
--   acesso sem loja veio do clique até hoje: a conferência abaixo mostra).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (as tabelas nunca existem lá).
-- Sem `drop`: pode ir pelo MCP. Aplicar na NUVEM ANTES do merge. Idempotente.
set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null then
    raise exception 'A 425 depende da 295 (integracao_token_loja) e da 336 (autorizacao_id): aplique-as antes.';
  end if;
end $$;

create unique index if not exists uq_integracao_token_loja_clique_empresa
  on integracao_token_loja (tenant_id, cliente)
  where revogado_em is null and autorizacao_id is not null and unidade_id is null;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`. (O índice procurado só neste schema: o banco de
-- teste tem outros schemas com os mesmos nomes.)
select 'índice único do acesso da empresa inteira pelo clique' as objeto,
       exists (select 1 from pg_indexes
                where schemaname = current_schema() and tablename = 'integracao_token_loja'
                  and indexname = 'uq_integracao_token_loja_clique_empresa'
                  and indexdef ilike '%unique%(tenant_id, cliente)%'
                  and indexdef ilike '%unidade_id is null%') as ok
union all
select 'nenhuma empresa com dois acessos ativos do clique sem loja',
       not exists (select 1 from integracao_token_loja
                    where revogado_em is null and autorizacao_id is not null and unidade_id is null
                    group by tenant_id, cliente having count(*) > 1);
