-- @cloud-only
-- 368 — A PONTE DO CHAT PAUSADA NUM PC (peça 6 do protótipo de conexão, "Pausar a ponte do chat").
--
-- Quem está no PC da ponte pode PAUSAR a ponte dali (o ícone da ponte perto do relógio ou a janela "Estado da ponte"):
-- ela para de ler e de responder o chat NAQUELE PC, na hora, e segue pausada até alguém retomar (também depois de o PC
-- reiniciar). A nuvem precisa saber: a ponte pausada não responde pelo chat (a regra única de quem responde passa a vez
-- para a reserva — `lideranca.ts`), e as telas dizem "pausada neste PC" em vez de "sem login" (que seria mentira: o
-- iFood segue logado lá dentro). A ponte manda `pausada` no sinal de vida; aqui fica DESDE QUANDO (nulo = não pausada).
--
-- Só na nuvem, como a 366: a ponte fala só com a nuvem.

alter table chat_ponte add column if not exists pausada_em timestamptz;

-- Conferência no MESMO Run: tem de vir `ok = true`.
select 'chat_ponte.pausada_em (desde quando a ponte está pausada no PC)' as objeto,
       exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = 'chat_ponte' and column_name = 'pausada_em'
                  and data_type = 'timestamp with time zone' and is_nullable = 'YES') as ok;
