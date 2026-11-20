-- @cloud-only
-- 464 · "SENTIMOS SUA FALTA" PELO RITMO DE CADA CLIENTE (F7 parte 2 do `docs/plano-perfil-cliente.md`, §6.3 — aprovada pelo
-- dono em 19/11/2026). Só NUVEM, como a 356 (as automáticas moram lá; SO_NUVEM no sync-daemon).
--
-- relacionamento_config.volta_pelo_ritmo — com o módulo "Perfil do cliente" ligado, a automática "sentimos sua falta" chama
--   quem está ATRASADO contra o próprio ritmo (dias sem pedir > 1,5 × o intervalo habitual dele — o mesmo corte da etiqueta
--   "atrasado" do perfil), como a Klaviyo: quem pede toda semana recebe com uns 10 dias, quem pede todo mês, com uns 45.
--   Quem ainda não tem ritmo (menos de 2 pedidos diretos) segue o "Quem não pede há" de sempre. Nasce DESLIGADO.
--
-- Coluna nova com padrão (sem reescrever a tabela no PG 11+). Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225).
-- Idempotente.
set local lock_timeout = '5s';

alter table relacionamento_config add column if not exists volta_pelo_ritmo boolean not null default false;

-- Conferência (no mesmo Run).
select exists (select 1 from information_schema.columns where table_schema = current_schema()
                 and table_name = 'relacionamento_config' and column_name = 'volta_pelo_ritmo') as coluna;
