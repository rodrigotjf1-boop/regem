-- @cloud-only
-- 503 — MISTER: os modelos de compra e os apelidos da empresa (versão 9, fase O2; `docs/plano-mister.md` § "Versão 9",
-- decisão V9-4: "modelo por fornecedor e apelidos da empresa, com a tela"; protótipo `mockups/regem-mister-v9.html`, abas
-- "No celular" (o próximo cupom do mesmo fornecedor) e "Na loja" (Mister › Modelos de compra)).
--
--   mister_de_para (mig 441, a memória "este produto deste fornecedor é tal insumo") ganha o que a tela mostra e o que o
--   próximo cupom compara:
--     descricao              o nome do produto como o fornecedor escreve (a última vez)
--     fornecedor_nome        o nome do emitente como veio na nota (a tela agrupa por fornecedor)
--     ultima_quantidade      a quantidade da última nota lançada, na unidade da nota
--     ultimo_preco_centavos  o preço unitário da última nota lançada
--     vezes                  quantas notas lançadas trouxeram o produto
--     usado_em               a última nota lançada com o produto ("parado há 60 dias" na tela)
--
--   mister_apelido — o nome que a empresa usa para um insumo, para qualquer fornecedor ("carne 120" = Carne 120gr): nasce
--     quando a pessoa confirma uma linha da lista com o nome diferente do cadastro; a lista seguinte liga sozinha. Uma linha
--     por nome (o novo vence).
--
--   mister_conversa_config.aprender_modelos  "Aprender o modelo de cada fornecedor": o resumo da nota diz o que já conhecia e o
--     que mudou, e a lista usa e grava os apelidos. Nasce DESLIGADO (regra do dono: recurso novo nasce desligado) e só o
--     presidente muda. Sem custo. A memória do fornecedor que já existia (mig 441) continua como era, ligada ou não.
--
-- ⚠️ SÓ NUVEM: `mister_de_para`, `mister_conversa_config` e `mister_apelido` são SO_NUVEM no sync-daemon (o `mister_apelido`
-- entra na lista neste PR: vai no próximo `.exe`), e o servidor da loja pula o arquivo. Sem `drop`: vai pelo MCP (LIC-171).
-- Idempotente; não apaga dado. RLS ligada e SEM política (como as do Mister desde a 414).
set local lock_timeout = '5s';

alter table mister_de_para
  add column if not exists descricao text,
  add column if not exists fornecedor_nome text,
  add column if not exists ultima_quantidade numeric,
  add column if not exists ultimo_preco_centavos bigint,
  add column if not exists vezes integer not null default 0,
  add column if not exists usado_em timestamptz;

create table if not exists mister_apelido (
  tenant_id      uuid not null references empresa(id) on delete cascade,
  chave          text not null,                              -- o nome sem acento, em minúsculas, palavras separadas por espaço
  texto          text not null,                              -- como a pessoa escreveu (a última vez)
  item_id        uuid not null,                              -- o insumo (item_estoque)
  vezes          integer not null default 1,
  alterado_por   uuid,
  criado_em      timestamptz not null default clock_timestamp(),
  atualizado_em  timestamptz not null default clock_timestamp(),
  primary key (tenant_id, chave),
  constraint ck_mister_apelido_chave check (length(chave) between 2 and 120)
);
alter table mister_apelido enable row level security;
comment on table mister_apelido is 'Mister O2 (mig 503): o nome que a empresa usa para um insumo, para qualquer fornecedor — só nuvem';

alter table mister_conversa_config
  add column if not exists aprender_modelos boolean not null default false;
comment on column mister_conversa_config.aprender_modelos is
  'Mister O2 (mig 503): o resumo da nota com o modelo do fornecedor e os apelidos na lista. Nasce desligado; só o presidente muda.';

-- Conferência (no mesmo Run).
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_de_para'
         and column_name in ('descricao', 'fornecedor_nome', 'ultima_quantidade', 'ultimo_preco_centavos', 'vezes', 'usado_em')) <> 6 then
    raise exception 'mig 503: faltam colunas da mister_de_para';
  end if;
  if to_regclass('mister_apelido') is null then raise exception 'mig 503: falta a tabela mister_apelido'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_apelido')) then
    raise exception 'mig 503: a RLS da mister_apelido não está ligada';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = current_schema() and table_name = 'mister_conversa_config' and column_name = 'aprender_modelos') then
    raise exception 'mig 503: falta a coluna aprender_modelos da mister_conversa_config';
  end if;
end $$;

select 'de_para' as o_que, count(*)::text as detalhe from mister_de_para
union all
select 'apelidos', count(*)::text from mister_apelido
union all
select 'aprender_modelos ligados', count(*)::text from mister_conversa_config where aprender_modelos
 order by 1;
