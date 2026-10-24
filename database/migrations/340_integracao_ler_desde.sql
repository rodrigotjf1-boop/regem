-- @cloud-only
-- 340 · A JANELA DE LEITURA do aplicativo de parceiro (Hub DMS, F4 parte F, R1b; decisão do dono de 24/10/2026: o
-- parceiro lê só as vendas de DEPOIS da autorização).
-- Só NUVEM, como a 295, a 329 e a 336: o servidor da loja não tem a API de integração.
--
-- O que entra:
--   integracao_token_loja.ler_desde — o início da janela de leitura do acesso de PARCEIRO, gravado na troca do código do
--     clique, na mesma transação: o da autorização contínua (a re-autorização pelo clique herda o do acesso que ela troca,
--     se ele não estava suspenso por 90 dias sem uso) ou o momento da troca. Nulo nos acessos dos produtos da DMS (sem
--     janela) e nos de parceiro de antes desta migration (vale a criação do acesso). O guard só lê a coluna para o
--     parceiro aprovado.
--   idx_integracao_token_loja_cliente_ativo — os acessos ativos por cliente: a conta das 3 lojas da etapa de teste
--     (todas as empresas) na troca e na tela do clique.
--
-- Sem instrução destrutiva (a migration vai à nuvem pelo MCP: V9, ERR-225). Idempotente: rodar de novo não muda nada.

set local lock_timeout = '5s';

do $$
begin
  if to_regclass(current_schema() || '.integracao_token_loja') is null then
    raise exception 'A 340 depende da 295 (integracao_token_loja): aplique-a antes.';
  end if;
end $$;

alter table integracao_token_loja add column if not exists ler_desde timestamptz;

comment on column integracao_token_loja.ler_desde is
  'Aplicativo de parceiro: o início da janela de leitura das vendas (autorização contínua pelo clique). Nulo: sem janela (produtos da DMS) ou a criação do acesso.';

create index if not exists idx_integracao_token_loja_cliente_ativo
  on integracao_token_loja (cliente) where revogado_em is null;

-- Conferência no MESMO Run: as duas linhas têm de vir com `ok = true`.
select 'coluna integracao_token_loja.ler_desde' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'integracao_token_loja'
                  and column_name = 'ler_desde' and data_type = 'timestamp with time zone') as ok
union all
select 'índice dos acessos ativos por cliente',
       to_regclass(current_schema() || '.idx_integracao_token_loja_cliente_ativo') is not null;
