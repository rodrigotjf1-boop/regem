-- 291 — Valor aproximado dos tributos no cupom (Lei 12.741/2012), pela tabela do IBPT.
--
-- A NFC-e saía sem `vTotTrib`: a SEFAZ autoriza assim (o campo é opcional e conta como zero), mas a
-- lei continua valendo e a obrigação é com o consumidor — quem fiscaliza é o Procon, não a SEFAZ.
--
-- A tabela é dado da DISTRIBUIÇÃO, não de uma empresa: por isso NÃO tem `tenant_id` e não passa pelo
-- sync. A Regem baixa o arquivo no site do IBPT (só com login) e envia no console da distribuição; o
-- servidor da loja baixa da nuvem a do estado dele. Existe nos DOIS lados porque a NFC-e é emitida
-- nos dois. Sai uma versão por mês (vigência do dia 20 ao fim do mês seguinte, sobrepostas); uma
-- versão pode ser reemitida com a vigência estendida sem mudar a chave — por isso a vigência é
-- atualizável e a identidade é (uf, versao, chave).
--
-- `nota_fiscal.tributos_aprox`: o que foi calculado NA EMISSÃO (federal, estadual, municipal, total,
-- fonte, chave, versão). A reimpressão do cupom usa isto — recalcular com a tabela do mês seguinte
-- imprimiria outro valor para a mesma nota.
-- ⚠️ Aplicar na NUVEM ANTES do merge: o Drizzle nomeia todas as colunas de `nota_fiscal` no select
-- (sem a coluna, toda consulta de nota dá 42703).

create table if not exists ibpt_versao (
  id uuid primary key default gen_random_uuid(),
  uf text not null,
  versao text not null,
  chave text not null,
  fonte text not null,
  vigencia_inicio date not null,
  vigencia_fim date not null,
  linhas integer not null default 0,
  importada_em timestamptz not null default now(),
  importada_por text,
  unique (uf, versao, chave)
);

create index if not exists idx_ibpt_versao_uf_vigencia
  on ibpt_versao (uf, vigencia_inicio desc, vigencia_fim);

-- Só NCM (tipo 0 do arquivo): a NFC-e não tem item de serviço. `ex` = exceção da TIPI ('' = sem).
create table if not exists ibpt_aliquota (
  versao_id uuid not null references ibpt_versao(id) on delete cascade,
  ncm text not null,
  ex text not null default '',
  nacional_federal numeric(7,2) not null,
  importados_federal numeric(7,2) not null,
  estadual numeric(7,2) not null,
  municipal numeric(7,2) not null,
  primary key (versao_id, ncm, ex)
);

alter table nota_fiscal add column if not exists tributos_aprox jsonb;
