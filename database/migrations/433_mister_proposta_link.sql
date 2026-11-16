-- @cloud-only
-- 433 — MISTER: o LINK COM PIN das propostas (F4.2a de `docs/plano-mister.md`; protótipo `mockups/regem-mister-pin.html`,
-- aprovado pelo dono em 16/11/2026).
--
-- O que mexe com dinheiro, cancelamento ou configuração não se autoriza por botão: o Mister manda um link que abre a
-- página `/m/<código>` do Regem, que mostra a proposta e pede o PIN de quem recebeu. Colunas novas em `mister_proposta`:
--   link_hash      — o resumo (sha256) do código do link; o código inteiro NUNCA fica guardado. Um código novo a cada
--                    envio: o anterior para de valer (índice único parcial).
--   link_para      — o colaborador que recebeu o link: é o PIN dele que a página confere
--   link_criado_em — quando o link saiu; link_aberto_em — a primeira vez que a página abriu (para a auditoria)
--   pin_erros      — as tentativas de PIN gastas neste link (reservadas ANTES de conferir: no máximo 5, mesmo em paralelo)
--   bloqueada_em   — o quinto PIN errado bloqueou o link (a proposta fecha como `recusada`, com o motivo)
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a `mister_proposta` fica em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171).
set local lock_timeout = '5s';

alter table mister_proposta add column if not exists link_hash text;
alter table mister_proposta add column if not exists link_para uuid;
alter table mister_proposta add column if not exists link_criado_em timestamptz;
alter table mister_proposta add column if not exists link_aberto_em timestamptz;
alter table mister_proposta add column if not exists pin_erros int not null default 0;
alter table mister_proposta add column if not exists bloqueada_em timestamptz;
create unique index if not exists uq_mister_proposta_link on mister_proposta (link_hash) where link_hash is not null;
create index if not exists ix_mister_proposta_bloqueada on mister_proposta (bloqueada_em) where bloqueada_em is not null;

-- Conferência (no mesmo Run): as 6 colunas e os 2 índices.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_proposta'
         and column_name in ('link_hash', 'link_para', 'link_criado_em', 'link_aberto_em', 'pin_erros', 'bloqueada_em')) <> 6 then
    raise exception 'mig 433: faltam colunas do link na mister_proposta';
  end if;
  if (select count(*) from pg_indexes where schemaname = current_schema() and tablename = 'mister_proposta'
        and indexname in ('uq_mister_proposta_link', 'ix_mister_proposta_bloqueada')) <> 2 then
    raise exception 'mig 433: faltam os índices do link da mister_proposta';
  end if;
end $$;
