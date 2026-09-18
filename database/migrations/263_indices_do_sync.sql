-- 263_indices_do_sync.sql — Índices para a consulta do pull (chave composta cursor+id).
--
-- ⚠️ NÃO é @cloud-only: a consulta é a mesma no edge (restauração) — aplicar nos dois.
-- ⚠️ ADITIVA: não depende de código novo. Pode ir para a nuvem AGORA; o efeito é só desempenho.
--
-- POR QUÊ (medido no banco de desenvolvimento, média de 10 chamadas)
-- Um pull SEM NENHUMA NOVIDADE de uma empresa com 1.762 comandas custava 56 consultas,
-- 16.546 linhas lidas e 897 blocos — porque 38 das 59 tabelas do pull não tinham índice que
-- servisse ao `where tenant_id = ? and (cursor, id) > (?, ?) order by cursor, id`. O plano
-- mostrava `Sort` em memória e leitura proporcional ao TAMANHO DA EMPRESA, não ao que mudou.
-- Em 5.000 lojas isso projeta ~1,4 milhão de linhas lidas por segundo para entregar zero.
--
-- ⚠️ Em base grande, criar índice trava escrita na tabela. Com o porte atual (4 empresas) é
-- instantâneo. Se um dia a base estiver grande, rodar cada linha com CREATE INDEX CONCURRENTLY
-- (fora de transação), nunca este arquivo inteiro de uma vez.

create index if not exists idx_sync_unidade on unidade (tenant_id, updated_at, id);
create index if not exists idx_sync_setor on setor (tenant_id, updated_at, id);
create index if not exists idx_sync_funcao on funcao (tenant_id, updated_at, id);
create index if not exists idx_sync_perfil_acesso on perfil_acesso (tenant_id, updated_at, id);
create index if not exists idx_sync_colaborador on colaborador (tenant_id, updated_at, id);
create index if not exists idx_sync_turno on turno (tenant_id, updated_at, id);
create index if not exists idx_sync_etiqueta on etiqueta (tenant_id, updated_at, id);
create index if not exists idx_sync_kds_alerta_config on kds_alerta_config (tenant_id, updated_at, id);
create index if not exists idx_sync_equipamento on equipamento (tenant_id, updated_at, id);
create index if not exists idx_sync_delivery_config on delivery_config (tenant_id, updated_at, id);
create index if not exists idx_sync_etiqueta_template on etiqueta_template (tenant_id, updated_at, id);
create index if not exists idx_sync_categoria_produto on categoria_produto (tenant_id, updated_at, id);
create index if not exists idx_sync_produto on produto (tenant_id, updated_at, id);
create index if not exists idx_sync_ficha_tecnica on ficha_tecnica (tenant_id, updated_at, id);
create index if not exists idx_sync_bot_regra on bot_regra (tenant_id, updated_at, id);
create index if not exists idx_sync_feriado on feriado (tenant_id, created_at, id);
create index if not exists idx_sync_tipo_ocorrencia on tipo_ocorrencia (tenant_id, updated_at, id);
create index if not exists idx_sync_cardapio_config on cardapio_config (tenant_id, updated_at, id);
create index if not exists idx_sync_opcao on opcao (tenant_id, updated_at, id);
create index if not exists idx_sync_complemento on complemento (tenant_id, updated_at, id);
create index if not exists idx_sync_complemento_item on complemento_item (tenant_id, updated_at, id);
create index if not exists idx_sync_produto_complemento on produto_complemento (tenant_id, updated_at, id);
create index if not exists idx_sync_complemento_grupo on complemento_grupo (tenant_id, updated_at, id);
create index if not exists idx_sync_complemento_opcao on complemento_opcao (tenant_id, updated_at, id);
create index if not exists idx_sync_item_estoque on item_estoque (tenant_id, updated_at, id);
create index if not exists idx_sync_fornecedor on fornecedor (tenant_id, updated_at, id);
create index if not exists idx_sync_cliente on cliente (tenant_id, atualizado_em, id);
create index if not exists idx_sync_caixa_sessao on caixa_sessao (tenant_id, updated_at, id);
create index if not exists idx_sync_comanda on comanda (tenant_id, updated_at, id);
create index if not exists idx_sync_comanda_item on comanda_item (tenant_id, updated_at, id);
create index if not exists idx_sync_comanda_item_complemento on comanda_item_complemento (tenant_id, created_at, id);
create index if not exists idx_sync_producao_pedido on producao_pedido (tenant_id, updated_at, id);
create index if not exists idx_sync_producao_pedido_item on producao_pedido_item (tenant_id, updated_at, id);
create index if not exists idx_sync_pedido_externo on pedido_externo (tenant_id, updated_at, id);
create index if not exists idx_sync_pedido_externo_pagamento on pedido_externo_pagamento (tenant_id, created_at, id);
create index if not exists idx_sync_lancamento_caixa on lancamento_caixa (tenant_id, created_at, id);
create index if not exists idx_sync_movimento_estoque on movimento_estoque (tenant_id, created_at, id);
create index if not exists idx_sync_ponto_marcacao on ponto_marcacao (tenant_id, created_at, id);

-- Busca do "exclusão vence" no push: o id que chega do edge é procurado aqui antes de inserir.
create index if not exists idx_sync_exclusao_registro on sync_exclusao (tenant_id, tabela, registro_id);
