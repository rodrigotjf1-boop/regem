-- @cloud-only
-- 439 — MISTER: os DOCUMENTOS POR FOTO (M3a da versão 3 do protótipo `mockups/regem-mister.html`, aprovada pelo dono em
-- 17/11/2026 — conversas 11 a 13 e a parte "Documentos").
--
-- mister_documento — cada foto de boleto ou conta que chegou pelo WhatsApp do Mister, o que foi lido e o que aconteceu:
--     confirmar  → o Mister mostrou o que leu e perguntou "Lanço?" (conta de consumo, sem código, fornecedor novo ou a
--                  empresa no modo "pergunta antes")
--     falta      → faltou o valor ou o vencimento: pediu outra foto (ou, na próxima parte, a informação)
--     recusado   → a foto não deu (a linha digitável não conferiu, ilegível, não é documento, nota de fornecedor)
--     lancado    → virou conta a pagar (`titulo_id`), sozinho (o código conferiu e o fornecedor é cadastrado) ou no toque
--     desfeito   → "Desfazer": a conta a pagar foi cancelada
--   Uma leitura por foto (índice único no `wamid`): a Meta reenvia e nada duplica. O que veio do código de barras e o
--   que a IA leu ficam separados em `dados.origem` (a parte "Documentos" mostra "código", "IA" ou "cadastro"). A foto em
--   si NÃO é guardada aqui. Guarda o final do telefone de quem mandou, nunca o telefone inteiro.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as do Mister desde a 414).
set local lock_timeout = '5s';

create table if not exists mister_documento (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  unidade_id         uuid,                               -- a loja de quem mandou (NULL = a empresa inteira)
  colaborador_id     uuid not null,                      -- quem mandou a foto
  telefone_final     text,                               -- os 4 últimos dígitos de quem mandou
  wamid              text,                               -- a mensagem da foto (uma leitura por foto)
  tipo               text not null,                      -- boleto | conta | nota | outro
  situacao           text not null,
  motivo             text,                               -- conta | sem_codigo | fornecedor_novo | modo | ilegivel | codigo_nao_confere | …
  valor_centavos     bigint,
  vencimento         date,
  beneficiario       text,
  fornecedor_id      uuid,
  linha_digitavel    text,                               -- conferida pelos dígitos verificadores (common/boleto.ts)
  codigo_barras      text,
  titulo_id          uuid,                               -- a conta a pagar criada (titulo_financeiro)
  dados              jsonb not null default '{}'::jsonb, -- de onde veio cada campo ({"origem": {"valor": "codigo", …}})
  criado_em          timestamptz not null default clock_timestamp(),
  respondido_em      timestamptz,                        -- o toque em "Lançar", "Desfazer" ou "Mandar outra foto"
  atualizado_em      timestamptz not null default clock_timestamp(),
  constraint ck_mister_documento_tipo check (tipo in ('boleto', 'conta', 'nota', 'outro')),
  constraint ck_mister_documento_situacao check (situacao in ('confirmar', 'falta', 'recusado', 'lancado', 'desfeito'))
);
create unique index if not exists uq_mister_documento_wamid on mister_documento (wamid) where wamid is not null;
create index if not exists ix_mister_documento_empresa on mister_documento (tenant_id, criado_em desc);
alter table mister_documento enable row level security;

comment on table mister_documento is 'Mister (mig 439): os documentos por foto (boleto e conta), o que foi lido e o lançamento — só nuvem';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas, os índices e as restrições.
do $$
begin
  if to_regclass('mister_documento') is null then raise exception 'mig 439: falta a tabela mister_documento'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_documento')) then
    raise exception 'mig 439: a RLS da mister_documento não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_documento'
         and column_name in ('id', 'tenant_id', 'unidade_id', 'colaborador_id', 'telefone_final', 'wamid', 'tipo', 'situacao',
                             'motivo', 'valor_centavos', 'vencimento', 'beneficiario', 'fornecedor_id', 'linha_digitavel',
                             'codigo_barras', 'titulo_id', 'dados', 'criado_em', 'respondido_em', 'atualizado_em')) <> 20 then
    raise exception 'mig 439: faltam colunas da mister_documento';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema() and tablename = 'mister_documento'
        and indexname in ('uq_mister_documento_wamid', 'ix_mister_documento_empresa')) <> 2 then
    raise exception 'mig 439: faltam índices da mister_documento';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('mister_documento')
        and conname in ('ck_mister_documento_tipo', 'ck_mister_documento_situacao')) <> 2 then
    raise exception 'mig 439: faltam as restrições da mister_documento';
  end if;
end $$;
