-- 455 · PEDIDO AGENDADO (D4 do atendente virtual; protótipo `mockups/regem-atendente-alergenos-agendado.html`, parte 2,
-- decisões G1–G10 aprovadas pelo dono em 16/11/2026 com as recomendadas; "pode" em 18/11). Nas DUAS pontas (nuvem e
-- loja): a configuração do cardápio e o pedido sincronizam pelo `updated_at` (sync-daemon).
--
-- O que entra (o pedido agendado usa a coluna `pedido_externo.agendamento` que já existe e se distingue pela
-- `retirada_tipo = 'agendado'` — a encomenda segue com 'encomenda'):
--   cardapio_config.agendado_ativo           — "Aceitar pedido agendado" (Delivery › Configurações › Cardápio digital ›
--                                              Encomenda, grupo "Pedido agendado"). NASCE DESLIGADO.
--   cardapio_config.agendado_antecedencia_min — antecedência mínima com a loja aberta (30, 45, 60, 90, 120; padrão 45).
--   cardapio_config.agendado_dias            — até quantos dias à frente (0 = só hoje, 1 = hoje e amanhã, 2, 3, 7; padrão 1).
--   cardapio_config.agendado_limite_janela   — pedidos agendados por janela de 15 min (2, 3, 4, 6, 8; padrão 4; vazio =
--                                              sem limite).
--   pedido_externo.agendado_preparo_avisado_em — quando o cliente foi avisado de que o pedido entrou em preparo (a rotina
--                                              da nuvem avisa uma vez só: a gravação condicional é o "já fiz").
--
-- Sem instrução destrutiva (vai à nuvem pelo MCP: V9, ERR-225). Idempotente. Coluna com padrão constante = só o catálogo
-- muda (Postgres 11+); o `lock_timeout` desiste em vez de enfileirar escrita atrás da tabela.
set local lock_timeout = '5s';

alter table cardapio_config add column if not exists agendado_ativo boolean not null default false;
alter table cardapio_config add column if not exists agendado_antecedencia_min integer not null default 45;
alter table cardapio_config add column if not exists agendado_dias integer not null default 1;
alter table cardapio_config add column if not exists agendado_limite_janela integer default 4;
alter table pedido_externo add column if not exists agendado_preparo_avisado_em timestamptz;
