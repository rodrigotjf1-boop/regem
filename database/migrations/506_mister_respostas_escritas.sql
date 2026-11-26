-- @cloud-only
-- 506 — MISTER: "A IA escreve as respostas" (versão 10, fase C9; aprovada pelo dono em 25/11/2026: "até na saída robótica, o
-- ideal é a IA tratar também a saída, dar uma variada de vez em quando" — `docs/plano-mister.md` § "Versão 10", protótipo
-- `mockups/regem-mister-v10.html`, "Na loja" › Avisos e relatórios › "A IA escreve as respostas").
--
--   mister_conversa_config.respostas_escritas  o "feito" e o "não deu" das ações saem escritos pela IA, no jeito da empresa,
--     variando as palavras; o que aconteceu continua sendo a frase do Regem (todos os números dela, nenhum novo, o caminho do
--     menu e o que está entre aspas), e passou de 5 segundos ou não passou na conferência vai a frase fixa. Nasce DESLIGADO
--     (regra do dono de 20/11: IA e pago nascem desligados, com o preço ao lado) e só o presidente muda.
--
-- Uma coluna própria (e não um grupo novo em `avisos_escritos`): a restrição da mig 447 só aceita os grupos de aviso, e mudá-la
-- pediria apagar e recriar a restrição, instrução destrutiva que pelo MCP volta recusada (LIC-171).
--
-- ⚠️ SÓ NUVEM: `mister_conversa_config` é SO_NUVEM no sync-daemon, e o servidor da loja pula o arquivo. Sem instrução destrutiva: vai pelo MCP
-- (LIC-171). Idempotente; não apaga dado.
set local lock_timeout = '5s';

alter table mister_conversa_config add column if not exists respostas_escritas boolean not null default false;

comment on column mister_conversa_config.respostas_escritas is
  'Versão 10, C9: o "feito" e o "não deu" das ações escritos pela IA (frase fixa de reserva). Nasce desligado; só o presidente muda.';
