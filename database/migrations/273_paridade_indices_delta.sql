-- 273_paridade_indices_delta.sql — índices que o delta do sync usa nas tabelas da 272.
--
-- ⚠️ NÃO é @cloud-only. ⚠️ Aplicar ANTES do merge. Idempotente.
-- Separada da 272 DE PROPÓSITO: o arquivo inteiro roda como uma transação só, e um índice
-- que demore demais desfaz junto o ALTER TABLE que veio antes — a migration "passa" e as
-- colunas não estão lá (GOTCHA já registrado). Colunas primeiro, índices depois.
--
-- O pull e o push perguntam sempre a mesma coisa: "o que mudou nesta empresa desde a marca
-- d'água?" — `where tenant_id = $1 and <cursor> > $2 order by <cursor>, id limit N`. Sem
-- índice, cada ciclo varre a tabela inteira; com 59 tabelas e um ciclo por minuto, isso vira
-- carga fixa no banco da loja e no da nuvem.

do $$
declare
  r record;
begin
  for r in
    select t.tabela, t.cursor
      from (values
        ('tarefa_def', 'updated_at'), ('tarefa_instancia', 'updated_at'),
        ('checklist', 'updated_at'), ('checklist_item', 'updated_at'), ('pop', 'updated_at'),
        ('documento_controlado', 'updated_at'), ('ciencia', 'created_at'),
        ('vistoria', 'updated_at'), ('ocorrencia', 'updated_at'), ('ponto_ajuste', 'created_at'),
        ('guia', 'updated_at'), ('guia_passo', 'created_at'),
        ('comunicado', 'updated_at'), ('comunicado_leitura', 'created_at'),
        ('clima_pesquisa', 'updated_at'), ('clima_resposta', 'created_at'), ('clima_participacao', 'created_at'),
        ('escala_alocacao', 'updated_at'), ('escala_regra', 'updated_at'), ('dia_especial', 'updated_at'),
        ('entitlement', 'updated_at'), ('janela_pico', 'updated_at'),
        ('funcao_setor', 'created_at'), ('colaborador_funcao', 'created_at'), ('modulo_ativacao', 'updated_at'),
        ('item_fornecedor', 'created_at'), ('categoria_item', 'updated_at'), ('item_conversao', 'created_at'),
        ('forma_pagamento', 'updated_at'), ('comanda_pagamento', 'created_at'),
        ('ordem_producao', 'updated_at'), ('mesa', 'updated_at'), ('alerta_estoque', 'atualizado_em'),
        ('produto_sugestao', 'created_at'), ('produto_faixa_preco', 'created_at'),
        ('produto_destino_producao', 'created_at'), ('setor_destino_producao', 'created_at'),
        ('complemento_destino_producao', 'created_at'), ('opcao_destino_producao', 'created_at'),
        ('kds_cor_config', 'updated_at'), ('tef_config', 'updated_at'), ('pagamento_tef', 'atualizado_em'),
        ('cupom', 'updated_at'), ('cupom_uso', 'created_at'),
        ('encomenda_regra_sinal', 'updated_at'), ('encomenda_recorrencia', 'updated_at'),
        ('banner', 'created_at'), ('acerto_subpdv', 'updated_at'), ('pedido_manutencao', 'updated_at'),
        ('contador', 'updated_at'), ('atendimento_chamado', 'atualizado_em'), ('nota_fiscal', 'updated_at')
      ) as t(tabela, cursor)
  loop
    -- Tabela/coluna que não existe neste banco é pulada: o mesmo arquivo roda na nuvem e
    -- em servidor local de qualquer versão.
    if exists (select 1 from information_schema.columns
                where table_schema = current_schema() and table_name = r.tabela and column_name = r.cursor)
       and exists (select 1 from information_schema.columns
                    where table_schema = current_schema() and table_name = r.tabela and column_name = 'tenant_id') then
      execute format(
        'create index if not exists idx_%s_sync on %I (tenant_id, %I, id)',
        r.tabela, r.tabela, r.cursor
      );
    end if;
  end loop;
end $$;
