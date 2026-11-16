-- @cloud-only
-- 428 — MISTER: as PROPOSTAS (F4.1 de `docs/plano-mister.md`, "Propor e aprovar"; conversas 5 e 6 do protótipo
-- `mockups/regem-mister.html`). O dono liberou a F4 em 15/11/2026.
--
-- mister_proposta — o que o Mister propõe para resolver um aviso, por um procedimento do CATÁLOGO FIXO do código
--   (`mister-procedimentos.ts`), e o que aconteceu com a proposta:
--     proposta   → saiu para o presidente, esperando a resposta (vale até `vence_em`: 10 minutos no botão)
--     autorizada → o presidente tocou "Autorizar" (uma vez só: gravação condicional na situação e no prazo)
--     recusada   → "Não agora"
--     vencida    → ninguém respondeu no prazo
--     executando → o Regem executou pelo serviço da tela e espera conferir o efeito (até `conferir_ate`)
--     feita      → o efeito foi conferido
--     nao_deu    → o efeito não apareceu no prazo da conferência (ou a execução foi recusada)
--   Uma proposta por aviso e procedimento (índice único): a volta repetida do aviso e a réplica a mais não duplicam.
--   Guarda quem autorizou (o colaborador e o final do telefone, nunca o telefone inteiro) e o resultado em texto curto.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como a 414 a 419).
set local lock_timeout = '5s';

create table if not exists mister_proposta (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references empresa(id) on delete cascade,
  unidade_id         uuid,                               -- a loja do aviso (NULL = a empresa inteira)
  aviso_id           uuid not null,                      -- o mister_aviso que a proposta resolve
  procedimento       text not null,                      -- imprimir_teste | consultar_nota | … (mister-procedimentos.ts)
  parametros         jsonb not null default '{}'::jsonb, -- o alvo do procedimento (a impressora, a nota) — sem dado pessoal
  nivel              text not null,                      -- botao | pin
  situacao           text not null default 'proposta',
  criada_em          timestamptz not null default clock_timestamp(),
  vence_em           timestamptz not null,
  respondida_em      timestamptz,
  autorizada_por     uuid,                               -- o colaborador que autorizou (ou recusou)
  telefone_final     text,                               -- os 4 últimos dígitos de quem respondeu
  executada_em       timestamptz,
  conferir_ate       timestamptz,                        -- até quando o Mister espera o efeito aparecer
  concluida_em       timestamptz,                        -- feita, nao_deu, recusada ou vencida
  resultado          text,                               -- a frase curta do que aconteceu
  constraint ck_mister_proposta_nivel check (nivel in ('botao', 'pin')),
  constraint ck_mister_proposta_situacao
    check (situacao in ('proposta', 'autorizada', 'recusada', 'vencida', 'executando', 'feita', 'nao_deu'))
);
create unique index if not exists uq_mister_proposta_aviso on mister_proposta (aviso_id, procedimento);
create index if not exists ix_mister_proposta_empresa on mister_proposta (tenant_id, criada_em desc);
create index if not exists ix_mister_proposta_andamento on mister_proposta (vence_em)
  where situacao in ('proposta', 'executando');
alter table mister_proposta enable row level security;

comment on table mister_proposta is 'Mister (mig 428): as propostas para resolver um aviso, por procedimento do catálogo fixo — só nuvem';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas, os índices e as restrições.
do $$
begin
  if to_regclass('mister_proposta') is null then raise exception 'mig 428: falta a tabela mister_proposta'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_proposta')) then
    raise exception 'mig 428: a RLS da mister_proposta não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_proposta'
         and column_name in ('id', 'tenant_id', 'unidade_id', 'aviso_id', 'procedimento', 'parametros', 'nivel', 'situacao',
                             'criada_em', 'vence_em', 'respondida_em', 'autorizada_por', 'telefone_final', 'executada_em',
                             'conferir_ate', 'concluida_em', 'resultado')) <> 17 then
    raise exception 'mig 428: faltam colunas da mister_proposta';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema() and tablename = 'mister_proposta'
        and indexname in ('uq_mister_proposta_aviso', 'ix_mister_proposta_empresa', 'ix_mister_proposta_andamento')) <> 3 then
    raise exception 'mig 428: faltam índices da mister_proposta';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('mister_proposta')
        and conname in ('ck_mister_proposta_nivel', 'ck_mister_proposta_situacao')) <> 2 then
    raise exception 'mig 428: faltam as restrições da mister_proposta';
  end if;
end $$;
