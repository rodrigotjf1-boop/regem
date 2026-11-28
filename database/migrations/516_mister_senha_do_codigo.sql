-- @cloud-only
-- 516 — MISTER: a senha para gerar o código de ligar o WhatsApp (rodada 7 de segurança, MIS-A-06, ERR-651; decisão do dono em
-- 28/11/2026: "pedir a senha ao gerar o código e avisar o celular antigo na troca").
--
-- O código de ligar saía para quem estava com a sessão do Regem aberta — num PC da loja, compartilhado, outra pessoa gerava o
-- código da conta de um gerente e ligava o próprio celular a ele. Agora gerar o código pede a SENHA de quem está logado
-- (`conferirSenhaDoColaborador`), com a trava das senhas erradas nestas colunas:
--
--   mister_vinculo.senha_erros        as tentativas na janela (a tentativa é RESERVADA na mesma instrução que confere o teto,
--                                     antes de conferir a senha — V98); a senha certa zera;
--   mister_vinculo.senha_erro_em      a última tentativa: a janela de 15 minutos conta daqui;
--   mister_vinculo.senha_travada_ate  depois de 5 erradas, trava por 15 minutos (a entrada no Regem não é travada).
--
-- ⚠️ SÓ NUVEM: `mister_vinculo` é SO_NUVEM no sync-daemon, e o servidor da loja pula o arquivo. Sem instrução destrutiva: vai pelo
-- MCP (LIC-171). Idempotente; não apaga dado.
set local lock_timeout = '5s';

alter table mister_vinculo add column if not exists senha_erros integer not null default 0;
alter table mister_vinculo add column if not exists senha_erro_em timestamptz;
alter table mister_vinculo add column if not exists senha_travada_ate timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_mister_vinculo_senha_erros') then
    alter table mister_vinculo add constraint ck_mister_vinculo_senha_erros check (senha_erros >= 0);
  end if;
end $$;

comment on column mister_vinculo.senha_erros is
  'Rodada 7, MIS-A-06: as tentativas da senha para gerar o código na janela de 15 min (reservadas antes de conferir); a certa zera.';
comment on column mister_vinculo.senha_travada_ate is
  'Rodada 7, MIS-A-06: depois de 5 senhas erradas, gerar o código fica travado até aqui (15 min).';

-- Conferência (no mesmo Run): as três colunas existem.
do $$
begin
  if (select count(*) from information_schema.columns
       where table_schema = current_schema() and table_name = 'mister_vinculo'
         and column_name in ('senha_erros', 'senha_erro_em', 'senha_travada_ate')) <> 3 then
    raise exception 'mig 516: faltam colunas da trava da senha em mister_vinculo';
  end if;
end $$;
