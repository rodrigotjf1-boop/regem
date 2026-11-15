-- @cloud-only
-- 423 — A VIGILÂNCIA DAS DEPENDÊNCIAS (F3, parte 2 do `docs/plano-mister.md`; protótipo
-- `mockups/regem-dependencias-e-qualidade.html`, vista "Console › Dependências").
--
-- dependencia_leitura — a última leitura de cada FONTE OFICIAL vigiada (as fontes moram no código,
--   `modules/dependencias/dependencias-fontes.ts`): quando leu, se deu certo, o trecho vigiado guardado (e o anterior,
--   para o antes e o depois), o que a leitura estruturada achou (a validade da versão da Graph API em uso, a situação dos
--   modelos de IA em uso) e a decisão de quem conferiu. É dado da DISTRIBUIÇÃO: sem `tenant_id`, nunca vai para a loja.
--   Fonte que não responde fica "não verificada desde" a última leitura certa — nunca vira "em dia" nem "retirada".
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro. Sem `tenant_id`: não entra na classificação do sync-daemon.
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como a 414 a 420).
set local lock_timeout = '5s';

create table if not exists dependencia_leitura (
  fonte              text primary key,                    -- o id da fonte no código
  lida_em            timestamptz,                         -- a última tentativa
  conferida_em       timestamptz,                         -- a última leitura que DEU CERTO
  status_http        integer,                             -- o da última tentativa
  falha              text,                                -- por que a última tentativa não leu (curto, sem dado de ninguém)
  trecho             text,                                -- o trecho vigiado, como texto (até 40 mil caracteres)
  hash               text,                                -- sha256 do trecho
  trecho_anterior    text,                                -- o trecho antes da última mudança (o "antes")
  hash_anterior      text,
  mudou_em           timestamptz,                         -- quando o trecho mudou pela última vez
  achados            jsonb not null default '{}'::jsonb,  -- o que a leitura estruturada achou
  decisao            text,                                -- conferida | nao_se_aplica (a decisão sobre a mudança vista)
  decidida_em        timestamptz,
  decidida_por       text,                                -- o nome de quem decidiu no console
  nota               text,                                -- a nota de quem decidiu (o critério, a tarefa)
  atualizado_em      timestamptz not null default now(),
  constraint ck_dependencia_leitura_decisao check (decisao is null or decisao in ('conferida', 'nao_se_aplica')),
  constraint ck_dependencia_leitura_trecho check (trecho is null or length(trecho) <= 40000),
  constraint ck_dependencia_leitura_trecho_anterior check (trecho_anterior is null or length(trecho_anterior) <= 40000)
);
alter table dependencia_leitura enable row level security;

comment on table dependencia_leitura is 'Vigilância das dependências (mig 423): a última leitura de cada fonte oficial vigiada — só nuvem, da distribuição';

-- Conferência no mesmo Run (LIC-171): a tabela e as colunas existem.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'dependencia_leitura'
         and column_name in ('fonte', 'conferida_em', 'trecho', 'hash', 'achados', 'decisao')) <> 6 then
    raise exception 'mig 423: dependencia_leitura incompleta';
  end if;
end $$;
