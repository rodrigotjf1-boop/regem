-- 050 — Delivery 2.0: kanban configurável + caixa próprio do delivery
-- (colunas visíveis por config, caixa separado por origem, entregador e flag de auto-aceite)

-- Visibilidade das colunas do quadro (kanban). Default: todas visíveis.
alter table delivery_config
  add column if not exists colunas jsonb not null
  default '{"chegada":true,"producao":true,"rota":true,"finalizado":true}';

-- Caixa por origem: separa a gaveta do balcão (pdv) da gaveta do delivery.
alter table caixa_sessao
  add column if not exists origem text not null default 'pdv';

-- Entregador atribuído no despacho (habilita o filtro "por entregador").
alter table pedido_externo add column if not exists entregador_id uuid;
alter table pedido_externo add column if not exists entregador_nome text;

-- Sinaliza pedido cujo aceite automático falhou (produto sem cadastro etc.):
-- aparece em destaque na coluna Chegada para tratamento manual.
alter table pedido_externo
  add column if not exists auto_aceite_falhou boolean not null default false;
