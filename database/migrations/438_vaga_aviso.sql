-- @cloud-only
-- 438 — VAGAS: o aviso da vaga ao banco de talentos PELO NÚMERO DE MARKETING da loja (F4b parte 2 do protótipo
-- `mockups/regem-vagas-talentos.html`, aprovado pelo dono em 15/11/2026; a parte 1, #1032, é a via sem número de marketing).
--
-- vaga_aviso — a FILA dos avisos e o que aconteceu com cada um: uma linha por pessoa e função a cada vez que alguém pede
-- "Avisar pelo número de marketing". A rotina manda uma por vez, no ritmo das campanhas (Evolution 20 s, API oficial 7 s),
-- conferindo de novo na hora de mandar (a ficha no banco de talentos, a autorização de mensagens, o SAIR da loja).
--   situacao — na_fila | enviando (a rotina pegou) | enviado | nao_enviado (com o motivo)
--   funcao — o código da função na Página de vagas; o nome e o detalhe saem da página na hora de mandar
--   telefone — o da ficha (sem o 55), para achar o aviso quando a pessoa responde
--   resposta — 'interesse' ("Tenho interesse") ou 'saiu' ("Não quero mais receber", SAIR), com a hora
--   pedido_por / pedido_por_nome — quem pediu o aviso (o histórico da ficha diz quem avisou)
-- Uma pessoa e função só entram na fila uma vez enquanto esperam (índice único parcial). Os 30 dias entre avisos são os
-- do histórico da ficha (`candidato_evento`), a mesma régua da parte 1.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon → vai no `.exe`).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as outras tabelas das vagas).
set local lock_timeout = '5s';

create table if not exists vaga_aviso (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references empresa(id) on delete cascade,
  unidade_id       uuid not null references unidade(id) on delete cascade,
  candidato_id     uuid not null references candidato(id) on delete cascade,
  funcao           text not null,
  telefone         text not null,
  situacao         text not null default 'na_fila',
  motivo           text,
  wamid            text,
  pedido_por       uuid,
  pedido_por_nome  text,
  criado_em        timestamptz not null default clock_timestamp(),
  enviado_em       timestamptz,
  resposta         text,
  respondido_em    timestamptz,
  constraint ck_vaga_aviso_situacao check (situacao in ('na_fila', 'enviando', 'enviado', 'nao_enviado')),
  constraint ck_vaga_aviso_resposta check (resposta is null or resposta in ('interesse', 'saiu'))
);
create unique index if not exists uq_vaga_aviso_esperando on vaga_aviso (candidato_id, funcao) where situacao in ('na_fila', 'enviando');
create index if not exists ix_vaga_aviso_fila on vaga_aviso (tenant_id, criado_em) where situacao = 'na_fila';
create index if not exists ix_vaga_aviso_telefone on vaga_aviso (tenant_id, telefone, enviado_em desc) where situacao = 'enviado';
alter table vaga_aviso enable row level security;

comment on table vaga_aviso is 'Vagas (mig 438): a fila do aviso da vaga ao banco de talentos pelo número de marketing — só nuvem';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas, as restrições e os índices.
do $$
begin
  if to_regclass('vaga_aviso') is null then raise exception 'mig 438: falta a tabela vaga_aviso'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('vaga_aviso')) then
    raise exception 'mig 438: a RLS da vaga_aviso não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'vaga_aviso'
         and column_name in ('id', 'tenant_id', 'unidade_id', 'candidato_id', 'funcao', 'telefone', 'situacao', 'motivo', 'wamid',
                             'pedido_por', 'pedido_por_nome', 'criado_em', 'enviado_em', 'resposta', 'respondido_em')) <> 15 then
    raise exception 'mig 438: faltam colunas na vaga_aviso';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('vaga_aviso')
        and conname in ('ck_vaga_aviso_situacao', 'ck_vaga_aviso_resposta')) <> 2 then
    raise exception 'mig 438: faltam as restrições da vaga_aviso';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema() and tablename = 'vaga_aviso'
        and indexname in ('uq_vaga_aviso_esperando', 'ix_vaga_aviso_fila', 'ix_vaga_aviso_telefone')) <> 3 then
    raise exception 'mig 438: faltam os índices da vaga_aviso';
  end if;
end $$;
