-- @cloud-only
-- 465 · O GRUPO DE CONTROLE DAS CAMPANHAS (F7 parte 3 do `docs/plano-perfil-cliente.md`, §6.3 "medir de verdade" — aprovada
-- pelo dono em 19/11/2026). Só NUVEM, como a 356 (SO_NUVEM no sync-daemon).
--
-- relacionamento_config.grupo_controle — ligado, ~10% dos clientes (sempre os mesmos: um sorteio fixo pelo id do cliente e
--   da empresa — `common/grupo-de-controle.ts`) NÃO recebem as campanhas. Cada campanha criada com ele ligado guarda os do
--   controle em `campanha_envio` com status 'controle' (nunca enviados), e o resultado compara quem recebeu × quem ficou
--   no controle — o efeito de verdade, não "pediu depois da mensagem" (como o Global Control Group da Braze). As
--   automáticas não mudam. Nasce DESLIGADO.
--
-- Coluna nova com padrão. Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente.
set local lock_timeout = '5s';

alter table relacionamento_config add column if not exists grupo_controle boolean not null default false;

-- Conferência (no mesmo Run).
select exists (select 1 from information_schema.columns where table_schema = current_schema()
                 and table_name = 'relacionamento_config' and column_name = 'grupo_controle') as coluna;
