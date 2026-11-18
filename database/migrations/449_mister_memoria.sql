-- @cloud-only
-- 449 — MISTER: a MEMÓRIA do Mister (versão 4, fase M4b — protótipo `mockups/regem-mister-jeito-memoria.html`, aprovado
-- pelo dono em 18/11/2026 com as oito decisões recomendadas; o padrão MEMORY.md/USER.md do Hermes Agent, com os mesmos
-- limites). A 448 é de outra frente (o gasto do WhatsApp).
--
-- mister_memoria — uma anotação curta por linha:
--   colaborador_id  — null = da EMPRESA (entra em toda conversa da empresa); preenchido = DA PESSOA (só na conversa dela)
--   texto           — uma frase de até 300 letras, numa linha. Contexto e preferência; NUNCA número de venda/valor/estoque,
--                     dado de cliente, senha, código ou PIN — o SERVIDOR recusa antes de gravar (mister-memoria.ts)
--   origem          — conversa (o Mister anotou porque a pessoa pediu ou corrigiu o jeito dele) | presidente (escreveu na tela)
--   anotado_por     — quem disse ou escreveu
-- Os limites (2.200 letras da empresa, 1.375 de cada pessoa) são conferidos pelo serviço com a trava da empresa, na mesma
-- transação que grava.
--
-- ⚠️ SÓ NUVEM: o servidor da loja pula o arquivo inteiro (a tabela fica em SO_NUVEM no sync-daemon).
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e SEM política (como as do Mister desde a 414).
set local lock_timeout = '5s';

create table if not exists mister_memoria (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references empresa(id) on delete cascade,
  colaborador_id  uuid references colaborador(id) on delete cascade,
  texto           text not null,
  origem          text not null,
  anotado_por     uuid,
  criado_em       timestamptz not null default clock_timestamp(),
  atualizado_em   timestamptz not null default clock_timestamp(),
  constraint ck_mister_memoria_texto check (char_length(texto) between 1 and 300 and position(chr(10) in texto) = 0),
  constraint ck_mister_memoria_origem check (origem in ('conversa', 'presidente'))
);
create index if not exists ix_mister_memoria_dono on mister_memoria (tenant_id, colaborador_id, criado_em);
alter table mister_memoria enable row level security;

comment on table mister_memoria is 'Mister (mig 449): a memória curta — da empresa (colaborador_id null) e de cada pessoa — só nuvem';

-- Conferência (no mesmo Run): a tabela com RLS, as colunas, as restrições e o índice.
do $$
begin
  if to_regclass('mister_memoria') is null then raise exception 'mig 449: falta a tabela mister_memoria'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('mister_memoria')) then
    raise exception 'mig 449: a RLS da mister_memoria não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_memoria'
         and column_name in ('id', 'tenant_id', 'colaborador_id', 'texto', 'origem', 'anotado_por', 'criado_em', 'atualizado_em')) <> 8 then
    raise exception 'mig 449: faltam colunas da mister_memoria';
  end if;
  if (select count(*) from pg_constraint where conrelid = to_regclass('mister_memoria')
         and conname in ('ck_mister_memoria_texto', 'ck_mister_memoria_origem')) <> 2 then
    raise exception 'mig 449: faltam restrições da mister_memoria';
  end if;
  if to_regclass('ix_mister_memoria_dono') is null then raise exception 'mig 449: falta o índice ix_mister_memoria_dono'; end if;
end $$;
