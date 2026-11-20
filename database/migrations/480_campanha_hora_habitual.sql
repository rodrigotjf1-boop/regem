-- @cloud-only
-- 480 · A CAMPANHA NA HORA HABITUAL DE CADA CLIENTE (F7 parte 4b do `docs/plano-perfil-cliente.md`, §6.3 "envio na hora
-- habitual" — aprovada pelo dono em 19/11/2026; protótipo `mockups/regem-perfil-cliente.html`, aba "Marketing", cartão
-- "Quando enviar"). Só NUVEM, como a 195 (SO_NUVEM no sync-daemon).
--
-- campanha.envio_habitual — a campanha manda a cada cliente de 30 a 60 min antes da faixa em que ele costuma pedir naquele
--   dia da semana (o perfil, camada 4); quem tem pouco histórico recebe antes do pico da loja naquele dia. Nasce DESLIGADO
--   (a campanha de hoje segue "num horário fixo"). Pelo perfil, só alcança o aceite de marketing CLICADO (D4/D15).
-- campanha_envio.minutos_alvo — os 7 momentos de envio deste destinatário (índice 1 = segunda … 7 = domingo, o dia de
--   operação), em minutos desde a meia-noite do dia de operação (a madrugada passa de 1440). Nulo = a qualquer hora.
--   Calculado uma vez, no criar (`modules/perfil-cliente/hora-habitual.ts`); a fila manda quando o relógio chega nele.
--
-- Colunas novas, sem reescrever a tabela (padrão constante / nulo). Sem instrução destrutiva (vai à nuvem pelo MCP: V9,
-- ERR-225). Idempotente.
set local lock_timeout = '5s';

alter table campanha add column if not exists envio_habitual boolean not null default false;
alter table campanha_envio add column if not exists minutos_alvo smallint[];

-- Conferência (no mesmo Run).
select (select count(*) from information_schema.columns where table_schema = current_schema()
          and ((table_name = 'campanha' and column_name = 'envio_habitual')
            or (table_name = 'campanha_envio' and column_name = 'minutos_alvo'))) = 2 as ok;
