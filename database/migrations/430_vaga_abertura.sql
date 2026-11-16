-- @cloud-only
-- 430 — VAGAS: de onde vêm as fichas (F5a do protótipo `mockups/regem-vagas-talentos.html`, aprovado pelo dono em
-- 15/11/2026; decisão 7).
--
-- vaga_abertura — quantas vezes a Página de vagas da loja foi ABERTA, por dia e por origem:
--   origem = o código de um QR da loja (`vaga_qr.codigo`), o canal do robô ('whatsapp', 'direct', 'messenger') ou ''
--   (o link sem origem — e toda origem que não é nenhuma dessas, para ninguém criar linha com texto inventado).
--   Um aparelho conta uma vez por dia (o cookie do dia na página pública). NADA identifica ninguém: sem IP, sem aparelho,
--   sem pessoa — só o número do dia. A soma é um `insert … on conflict do update` (uma linha por loja, dia e origem).
--   O dia é o da operação (o serviço manda `hojeISO()`, nunca o `current_date` do banco — V46).
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as outras tabelas das vagas).
set local lock_timeout = '5s';

create table if not exists vaga_abertura (
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid not null references unidade(id) on delete cascade,
  dia            date not null,
  origem         text not null default '',
  aberturas      integer not null default 0,
  atualizado_em  timestamptz not null default clock_timestamp(),
  constraint pk_vaga_abertura primary key (tenant_id, unidade_id, dia, origem),
  constraint ck_vaga_abertura_origem check (origem = '' or origem ~ '^[a-z0-9][a-z0-9-]{0,29}$'),
  constraint ck_vaga_abertura_aberturas check (aberturas >= 0)
);
alter table vaga_abertura enable row level security;

comment on table vaga_abertura is 'Vagas (mig 430): aberturas da Página de vagas por loja, dia e origem — sem dado de pessoa; só nuvem';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas, a chave e as restrições.
do $$
begin
  if to_regclass('vaga_abertura') is null then raise exception 'mig 430: falta a tabela vaga_abertura'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('vaga_abertura')) then
    raise exception 'mig 430: a RLS da vaga_abertura não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'vaga_abertura'
         and column_name in ('tenant_id', 'unidade_id', 'dia', 'origem', 'aberturas', 'atualizado_em')) <> 6 then
    raise exception 'mig 430: faltam colunas da vaga_abertura';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('vaga_abertura')
        and conname in ('pk_vaga_abertura', 'ck_vaga_abertura_origem', 'ck_vaga_abertura_aberturas')) <> 3 then
    raise exception 'mig 430: faltam a chave ou as restrições da vaga_abertura';
  end if;
end $$;
