-- 306 — Modelo do desenho da etiqueta de validade: 'classico' (o de sempre) ou 'moderno'
-- (faixa preta com o produto, quem/quando à esquerda, QR à direita e a validade com o dia
-- da semana em caixa preta — escolha do dono em 06/10/2026, entre três modelos de mercado).
--
-- Padrão 'classico': nenhuma loja muda de etiqueta sem escolher. A coluna entra no schema
-- do Drizzle, então a nuvem precisa dela ANTES do merge; no servidor da loja ela vem no
-- próprio pacote de atualização. NÃO é @cloud-only: `etiqueta_template` existe nos dois
-- bancos e sincroniza nos dois sentidos. Servidor de loja ainda sem a coluna recebe o
-- modelo sem ela e segue no clássico; a reconciliação do sync a preenche depois da
-- atualização. Idempotente.
set local lock_timeout = '5s';

alter table etiqueta_template
  add column if not exists modelo text not null default 'classico';

-- Conferência no MESMO Run: todas as linhas têm de vir com `ok = true`.
select 'coluna etiqueta_template.modelo' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'etiqueta_template'
                  and column_name = 'modelo'
                  and data_type = 'text' and is_nullable = 'NO') as ok
union all
select 'padrão clássico (como hoje)',
       coalesce((select column_default from information_schema.columns
                  where table_schema = current_schema() and table_name = 'etiqueta_template'
                    and column_name = 'modelo'), '') like '%classico%';
