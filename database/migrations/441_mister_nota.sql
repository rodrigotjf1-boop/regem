-- @cloud-only
-- 441 — MISTER: a NOTA DO FORNECEDOR por foto (M3b, versão 3 do protótipo `mockups/regem-mister.html`, aprovada pelo dono
-- em 17/11/2026 — conversa 12 e a decisão 2: a nota sempre mostra e pergunta antes, porque mexe no estoque e no custo).
--
-- mister_documento.recebimento_id — a nota lançada vira um recebimento (Estoque › Recebimento) pelo MESMO serviço da
--   tela; aqui fica a ligação (a conta a pagar continua em `titulo_id`, a primeira parcela).
--
-- mister_de_para — a memória "este produto deste fornecedor é tal insumo" (para a próxima nota não perguntar de novo):
--   fornecedor_cnpj + chave (o código do produto no fornecedor, "cod:…"; sem código, as palavras da descrição, "desc:…")
--   → o insumo (NULL = "não entra no estoque") e o fator (quantas unidades de estoque vale 1 unidade da nota; NULL = a
--   mesma unidade). Grava quando o presidente responde; uma linha por chave (a resposta nova vence).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (`mister_de_para` em SO_NUVEM no sync-daemon; `mister_documento`
-- já está lá).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as do Mister desde a 414).
set local lock_timeout = '5s';

alter table mister_documento add column if not exists recebimento_id uuid;

create table if not exists mister_de_para (
  tenant_id          uuid not null references empresa(id) on delete cascade,
  fornecedor_cnpj    text not null,
  chave              text not null,
  item_id            uuid,                               -- o insumo (item_estoque); NULL = não entra no estoque
  fator              numeric,                            -- unidades de estoque por 1 unidade da nota; NULL = a mesma
  unidade_nota       text,
  alterado_por       uuid,
  atualizado_em      timestamptz not null default now(),
  primary key (tenant_id, fornecedor_cnpj, chave),
  constraint ck_mister_de_para_fator check (fator is null or fator > 0)
);
alter table mister_de_para enable row level security;

comment on table mister_de_para is 'Mister (mig 441): o de-para dos produtos da nota do fornecedor para os insumos do estoque — só nuvem';

-- Conferência (no mesmo Run).
do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = current_schema() and table_name = 'mister_documento' and column_name = 'recebimento_id') then
    raise exception 'mig 441: falta a coluna recebimento_id da mister_documento';
  end if;
  if to_regclass('mister_de_para') is null then raise exception 'mig 441: falta a tabela mister_de_para'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_de_para')) then
    raise exception 'mig 441: a RLS da mister_de_para não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_de_para'
         and column_name in ('tenant_id', 'fornecedor_cnpj', 'chave', 'item_id', 'fator', 'unidade_nota', 'alterado_por', 'atualizado_em')) <> 8 then
    raise exception 'mig 441: faltam colunas da mister_de_para';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('mister_de_para') and conname = 'ck_mister_de_para_fator') then
    raise exception 'mig 441: falta a restrição do fator da mister_de_para';
  end if;
end $$;
