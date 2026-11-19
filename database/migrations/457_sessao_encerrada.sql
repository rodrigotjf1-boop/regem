-- 457 — SAIR ENCERRA A SESSÃO NO SERVIDOR (3ª rodada de segurança, 19/11/2026, achado R3-01; ERR-534). A 456 é de outra
-- frente (o formulário do WhatsApp da avaliação do pedido).
--
-- Antes, "Sair" só apagava o cookie (nuvem) ou o token guardado (servidor da loja): uma cópia do token, feita antes,
-- continuava valendo até vencer (12 h). Agora cada sessão nasce com um número próprio (`jti`, no token) e "Sair" grava esse
-- número aqui; o guarda das rotas e o tempo real recusam a sessão encerrada.
--
-- sessao_encerrada — uma linha por sessão encerrada:
--   jti        — o número da sessão (o `jti` do token); a chave
--   expira_em  — quando o token venceria de qualquer jeito (o `exp` dele); depois disso a linha não serve mais e é apagada
--                pela própria saída (a varredura das vencidas há mais de 1 dia)
--   criado_em  — quando saiu
--
-- NAS DUAS PONTAS (não é só nuvem): o servidor da loja emite e confere os tokens dele, e a nuvem os dela — cada lado
-- encerra as próprias sessões. Sem `tenant_id` de propósito: é estado de segurança desta máquina, lido só pelo `jti` (um
-- número aleatório), nunca dado de negócio de uma empresa — e assim fica fora do sincronismo (o daemon só olha as tabelas
-- com `tenant_id`), sem `.exe` novo. Apagar a tabela numa reinstalação só devolve a validade às cópias de tokens que já
-- iam vencer em até 12 h.
--
-- Idempotente; nada que apague objeto (LIC-171). RLS ligada e sem política (o app é o dono da tabela).
set local lock_timeout = '5s';

create table if not exists sessao_encerrada (
  jti        uuid primary key,
  expira_em  timestamptz not null,
  criado_em  timestamptz not null default clock_timestamp()
);
-- A varredura das vencidas (na saída) vai pelo vencimento.
create index if not exists ix_sessao_encerrada_expira on sessao_encerrada (expira_em);
alter table sessao_encerrada enable row level security;

comment on table sessao_encerrada is 'Sessões encerradas por "Sair" antes de vencer (mig 457, R3-01) — cada lado as suas, não sincroniza';

-- Conferência (no mesmo Run): a tabela com RLS, as três colunas, a chave e o índice.
do $$
begin
  if to_regclass('sessao_encerrada') is null then raise exception 'mig 457: falta a tabela sessao_encerrada'; end if;
  if not (select relrowsecurity from pg_class where oid = to_regclass('sessao_encerrada')) then
    raise exception 'mig 457: a RLS da sessao_encerrada não está ligada';
  end if;
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'sessao_encerrada'
         and column_name in ('jti', 'expira_em', 'criado_em')) <> 3 then
    raise exception 'mig 457: faltam colunas da sessao_encerrada';
  end if;
  if exists (select 1 from information_schema.columns
              where table_schema = current_schema() and table_name = 'sessao_encerrada' and column_name = 'tenant_id') then
    raise exception 'mig 457: a sessao_encerrada não pode ter tenant_id (ficaria sem classificação no sincronismo)';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = to_regclass('sessao_encerrada') and contype = 'p') then
    raise exception 'mig 457: falta a chave da sessao_encerrada';
  end if;
  if to_regclass('ix_sessao_encerrada_expira') is null then
    raise exception 'mig 457: falta o índice ix_sessao_encerrada_expira';
  end if;
end $$;
