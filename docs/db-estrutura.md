# Estrutura real do banco (nuvem — projeto Supabase `regen` / `yhwcehdoaqhexkriyehv`)

> Fonte da verdade da estrutura **real** em produção (não é o `schema.ts` do Drizzle — eles divergem).
> Gerado de `information_schema.columns` (schema `public`) em **02/08/2026**.
> **Consultar este arquivo ANTES de escrever qualquer migration** (confirmar em qual tabela a coluna vive).
> Regenerar com:
> ```sql
> select table_name, string_agg(column_name, ', ' order by ordinal_position) as colunas
> from information_schema.columns where table_schema='public'
> group by table_name order by table_name;
> ```
>
> ⚠️ **Pegadinha conhecida:** existem `cardapio_config` (config do cardápio público, ~65 colunas) **e** `delivery_config`
> (config operacional do delivery/kanban) — nomes parecidos, tabelas diferentes. `cupom_perfis`, `cupom_layout`,
> `pausado_ate`, `prep_*`, `setor_id`, `finalizado_horas` vivem em **`delivery_config`**. Confundir as duas causou o
> 500 do #260 (mig 161 criou `cupom_perfis` na tabela errada). Ver memória `migration-pooler-column-gotcha`.
>

## Tabelas A → cupom

- **acerto_subpdv** — id, tenant_id, unidade_id, comanda_id, mesa_id, sub_pdv_id, caixa_destino_id, valor_centavos, forma, recebido_centavos, diferenca_centavos, status, fechado_por_id, fechado_em, baixado_por_id, baixado_em, caixa_sessao_id, observacao, created_at, updated_at
- **alerta_estoque** — id, tenant_id, unidade_id, tipo, titulo, detalhe, prioridade, criado_em, resolvido_em, resolvido_por
- **api_client** — id, tenant_id, nome, secret_hash, scopes, status, created_at, updated_at
- **atendimento_chamado** — id, tenant_id, unidade_id, tipo, cliente, telefone, pedido_numero, mensagem, status, resolvido_por_id, resolvido_em, criado_em, pedido_id, decisao
- **ativacao** — id, revenda_id, tenant_id, token_hash, ramo, plano, modulos, trial, validade_ate, status, device_fingerprint, criado_em, ativado_em, atualizado_em
- **audit_log** — id, tenant_id, unidade_id, actor_tipo, actor_id, acao, entidade_tipo, entidade_id, detalhe, created_at, actor_perfil, tipo, origem, seq, prev_hash, hash
- **ausencia** — id, tenant_id, unidade_id, colaborador_id, data_inicio, data_fim, tipo, cobertura_alocacao_id, observacao, created_at, updated_at
- **banner** — id, tenant_id, unidade_id, imagem_ref, titulo, link, ordem, ativo, created_at
- **bot_atendimento** — id, tenant_id, colaborador_id, pergunta, regra_id, escalado, created_at
- **bot_regra** — id, tenant_id, unidade_id, tipo, gatilhos, resposta, escala, escala_condicao, ativa, created_at, updated_at, deleted_at
- **caixa_sessao** — id, tenant_id, unidade_id, status, valor_abertura, aberta_em, aberta_por_id, valor_informado, valor_esperado, diferenca, fechada_em, fechada_por_id, obs, created_at, turno_numero, origem, valores_informados, esperado_por_forma, diferenca_por_forma, updated_at, terminal_id
- **cardapio_bairro** — id, tenant_id, unidade_id, nome, taxa, ordem, ativo
- **cardapio_config** — id, tenant_id, unidade_id, token, ativo, modo, nome_publico, created_at, updated_at, ramo, logo_emoji, subtitulo, aberto, tempo_entrega_min, pedido_minimo, avaliacao, frete_gratis_acima, pagamentos, fidelidade_ativa, whatsapp, parcelas_max, auto_kds, formas_cartao, logo_ref, documento, responsavel_nome, responsavel_contato, contato_loja, instagram, site, end_cep, end_rua, end_numero, end_bairro, end_cidade, end_estado, end_referencia, end_complemento, tipo_delivery, tipo_retirada, tipo_local, horarios, area_modo, raios, end_lat, end_lng, robo_ativo, robo_saudacao, robo_ausencia, robo_prompt, robo_mensagens, evolution_instancia, evolution_numero, tema, tempo_retirada_min, menu_theme, tema_config, cancelamento_estorna_cashback, cupom_bloqueia_com_resgate, cupom_max_cashback_cent, fidelidade_intervalo_horas, robo_pausados, horarios_retirada, horario_unico, ~~cupom_perfis~~ *(criada por engano — mig 163 remove)*
- **cardapio_senha_seq** — tenant_id, canal, ultimo
- **cashback_movimento** — id, tenant_id, telefone, cliente_id, tipo, delta, origem, plano_id, pedido_id, criado_em
- **cashback_plano** — id, tenant_id, unidade_id, tipo, ativo, status, percentual, base, regras, prazo_resgate_dias, criado_em
- **cashback_produto_valor** — id, tenant_id, plano_id, produto_id, pontos
- **cashback_saldo** — id, tenant_id, telefone, cliente_id, tipo, saldo, expira_em, atualizado_em
- **cashback_vale** — id, tenant_id, telefone, cliente_id, produto_id, descricao, valor, status, criado_em, pedido_id
- **categoria_item** — id, tenant_id, nome, cor, created_at, updated_at, deleted_at
- **categoria_produto** — id, tenant_id, nome, parent_id, ordem, ativo, created_at, imagem_ref, descricao, disponibilidade, updated_at, deleted_at
- **checklist** — id, tenant_id, unidade_id, setor_id, nome, versao, estado, autor_id, aprovador_id, aprovado_em, created_at, updated_at, deleted_at
- **checklist_item** — id, tenant_id, checklist_id, ordem, descricao, procedimento, foto_ref, created_at, updated_at
- **ciencia** — id, tenant_id, colaborador_id, documento_id, versao, data, assinatura_ref
- **cliente** — id, tenant_id, nome, telefone, consentimento_lgpd, criado_em, atualizado_em
- **cliente_endereco** — id, tenant_id, cliente_id, apelido, cep, logradouro, numero, complemento, bairro, cidade, referencia, principal, criado_em, bairro_id, lat, lng
- **cliente_link** — id, tenant_id, cliente_id, slug, criado_em
- **cliente_otp** — id, tenant_id, telefone, codigo, expira_em, tentativas, criado_em, codigo_hash
- **clima_participacao** — id, tenant_id, pesquisa_id, colaborador_id, respondeu_em
- **clima_pesquisa** — id, tenant_id, unidade_id, titulo, aberta, created_at, deleted_at
- **clima_resposta** — id, tenant_id, pesquisa_id, humor, comentario, created_at
- **colaborador** — id, tenant_id, nome, foto_ref, funcao_id, vinculo, pin_hash, status, created_at, updated_at, deleted_at, email, senha_hash, matricula, consentimento_lgpd, data_consentimento, unidade_id, telefone, jornada_tipo, perfil_acesso_id, app_habilitado, ui_prefs, desligamento_tipo, aviso_inicio, aviso_opcao, aviso_fim, desligamento_data, desligamento_motivo, desligamento_por_id, desligado_em, ponto_enviado_em, ponto_enviado_contador_id, usuario
- **colaborador_funcao** — id, tenant_id, colaborador_id, funcao_id, created_at
- **colaborador_unidade** — id, tenant_id, colaborador_id, unidade_id, created_at
- **comanda** — id, tenant_id, unidade_id, mesa, cliente, status, taxa_servico_pct, aberta_em, fechada_em, aberta_por_id, obs, created_at, idempotency_key, total, forma, cancelada_em, cancelada_por_id, motivo_cancelamento, mesa_id, identificador, senha, updated_at, estoque_reaproveitado, origem_equipamento_id, cpf, consumo
- **comanda_item** — id, tenant_id, comanda_id, ficha_id, descricao, quantidade, preco_unitario, criado_por_id, created_at, produto_id, variacao_id, observacao, updated_at, origem_equipamento_id
- **comanda_item_complemento** — id, tenant_id, comanda_item_id, opcao_id, tipo, nome, preco_delta, ficha_ingrediente_id, item_id, quantidade, created_at, produto_ref_id
- **comanda_pagamento** — id, tenant_id, comanda_id, forma, forma_pagamento_id, valor, created_at
- **complemento** — id, tenant_id, nome, regra, obrigatorio, min, max, canais, ativo, created_at, updated_at, deleted_at
- **complemento_destino_producao** — id, tenant_id, complemento_id, equipamento_id, created_at
- **complemento_grupo** — id, tenant_id, produto_id, nome, tipo, min, max, obrigatorio, ordem, created_at, origem_complemento_id, deleted_at, updated_at
- **complemento_item** — id, tenant_id, complemento_id, opcao_id, preco, ordem, created_at, updated_at, deleted_at, padrao_marcada
- **complemento_opcao** — id, tenant_id, grupo_id, nome, preco_delta, ficha_ingrediente_id, item_id, quantidade, ordem, created_at, produto_ref_id, origem_opcao_id, deleted_at, updated_at, codigo_pdv, controla_estoque, padrao_marcada
- **compra_item** — id, tenant_id, lista_id, item_id, quantidade, custo_unitario
- **compra_lista** — id, tenant_id, unidade_id, nome, fornecedor_id, data_recebimento, delegado_id, enviar_kds, enviar_dashboard, status, recebida_em, created_at, updated_at, deleted_at
- **comunicado** — id, tenant_id, unidade_id, setor_id, autor_colaborador_id, titulo, corpo, audiencia, fixado, created_at, deleted_at
- **comunicado_leitura** — id, tenant_id, comunicado_id, colaborador_id, lido_em
- **contador** — id, tenant_id, nome, whatsapp, email, ativo, cadastrado_por_id, created_at, updated_at
- **contagem_execucao** — id, tenant_id, lista_id, data, status, delegado_id, criada_por_id, concluida_em, created_at
- **contagem_item** — id, tenant_id, execucao_id, item_id, saldo_sistema, contado, created_at
- **contagem_lista** — id, tenant_id, unidade_id, nome, recorrencia, dia_semana, dia_mes, hora, delegado_id, enviar_kds, enviar_dashboard, ativo, created_at, updated_at, deleted_at
- **contagem_lista_item** — id, tenant_id, lista_id, item_id
- **cupom** — id, tenant_id, unidade_id, codigo, tipo, valor, minimo, ativo, validade, created_at, teto_desconto, somente_novos, max_por_cliente, min_dias_sem_compra

## Tabelas cupom_uso → lote

- **cupom_uso** — id, tenant_id, cupom_id, cliente_id, telefone, pedido_id, usado_em
- **delivery_config** — id, tenant_id, unidade_id, ativo, auto_aceitar, merchant_id, created_at, updated_at, colunas, pausado_ate, pausa_motivo, prep_balcao_min, prep_balcao_max, prep_delivery_min, prep_delivery_max, setor_id, cupom_layout, finalizado_horas, cupom_perfis *(cupom_perfis vive AQUI — não em cardapio_config)*
- **desperdicio** — id, tenant_id, unidade_id, setor_id, colaborador_id, descricao, quantidade, unidade_medida, motivo, foto_ref, data, created_at, updated_at, deleted_at, item_id, custo_unitario
- **dia_especial** — id, tenant_id, unidade_id, colaborador_id, data, data_fim, tipo, nome, descricao, created_at, deleted_at
- **distribuicao_auditoria** — id, usuario_id, usuario_nome, perfil, acao, alvo, detalhe, ip, criado_em
- **documento_controlado** — id, tenant_id, unidade_id, tipo, titulo, escopo, versao, estado, conteudo, publicado_em, created_at, updated_at, deleted_at
- **edge_comando** — id, tenant_id, comando, status, solicitado_por, resultado, criado_em, executado_em
- **edge_heartbeat** — id, ativacao_id, tenant_id, versao, estado, ultimo_sync, disco_livre_mb, clientes, erro, recebido_em
- **edge_release** — id, versao, url, sha256, notas, publicado_por, publicado_em, assinatura
- **empresa** — id, nome, cnpj, ramo, plano, status, created_at, updated_at, deleted_at, trial_ate, is_distribuidor, stripe_customer_id, stripe_subscription_id, assinatura_status
- **entitlement** — id, tenant_id, modulo, ativo, created_at, updated_at
- **equipamento** — id, tenant_id, unidade_id, tipo, nome, token, mac, padrao, ativo, ultimo_ping, created_at, escopo, setor_id, host, porta, papel, vias, largura, setores_atendidos, impressora_padrao_id, conexao, dispositivo, imprime_ao_avancar, imprime_no_status, impressora_destino_id, pdv_main_id, pareamento_codigo, pareamento_expira_em, segredo_hash, pareado_em, ultimo_uso_em, revogado_em, last_push_seq, fingerprint, last_push_ts, proximo_kds_id
- **equipe** — id, tenant_id, unidade_id, nome, created_at, updated_at, deleted_at
- **equipe_membro** — id, tenant_id, equipe_id, colaborador_id
- **escala_alocacao** — id, tenant_id, unidade_id, data, turno_id, etiqueta_id, colaborador_id, tipo, status, observacao, created_at, updated_at, deleted_at, regra_id, hora_inicio_override, hora_fim_override, pausa_inicio_override, pausa_fim_override, presenca, comprovante_ref, presenca_obs, presenca_em
- **escala_regra** — id, tenant_id, unidade_id, colaborador_id, etiqueta_id, turno_id, jornada_tipo, folgas_semana, data_inicio, data_fim, feriados_fechar, ativo, created_at, updated_at, deleted_at
- **estoque_snapshot** — tenant_id, unidade_id, item_id, data, saldo, custo_medio
- **etiqueta** — id, tenant_id, unidade_id, setor_id, funcao_id, sigla, contador, cor, icone, titular_padrao_colaborador_id, created_at, updated_at, deleted_at
- **etiqueta_template** — id, tenant_id, unidade_id, nome, campos, tamanho, codigo_tipo, padrao, created_at, updated_at
- **etiqueta_validade** — id, tenant_id, unidade_id, produto_id, ficha_id, template_id, descricao, unidade_medida, tipo, status, fabricacao, compra, abertura, validade, codigo, impressa_em, baixado_em, baixado_por_id, virou_perda, desperdicio_id, criado_por_id, created_at, updated_at, deleted_at
- **feriado** — id, tenant_id, unidade_id, data, nome, created_at
- **ficha_ingrediente** — id, tenant_id, ficha_id, item_id, insumo_nome, quantidade, unidade, fator_correcao, custo_unitario, ordem, created_at, sub_ficha_id, somente_delivery
- **ficha_tecnica** — id, tenant_id, unidade_id, setor_id, pop_id, nome, categoria, rendimento, rendimento_unidade, validade, preco_venda, meta_cmv, ativo, created_at, updated_at, deleted_at, porcao_tamanho, porcao_unidade, validade_dias, validade_aberto_dias
- **fidelidade_cliente** — id, tenant_id, telefone, nome, pontos, atualizado_em, plano_id, cliente_id
- **fidelidade_plano** — id, tenant_id, unidade_id, nome, ativo, status, qualificador_tipo, qualificador_id, pontos_meta, recompensa_tipo, recompensa_valor, recompensa_produtos, prazo_resgate_dias, criado_em
- **fidelidade_ponto** — id, tenant_id, plano_id, telefone, cliente_id, pedido_id, criado_em, estornado
- **fidelidade_resgate** — id, tenant_id, plano_id, telefone, cliente_id, ganho_em, prazo_em, resgatado_em, pedido_id, status, gerado_por_pedido_id
- **fiscal_config** — id, tenant_id, unidade_id, ativo, ambiente, regime, crt, serie, proximo_numero, cnpj, razao_social, nome_fantasia, ie, uf, codigo_uf, codigo_municipio, endereco, csc_id, csc_token, cert_ref, created_at, updated_at
- **forma_pagamento** — id, tenant_id, nome, tipo, ativo, ordem, created_at, cardapio, tipos_pedido, taxa_extra, obs, bandeiras
- **fornecedor** — id, tenant_id, nome, cnpj, contato, telefone, email, obs, created_at, updated_at, deleted_at, lead_time_dias, prazo_pagamento_dias
- **funcao** — id, tenant_id, nome, categoria, setor_id, created_at, updated_at, deleted_at
- **funcao_setor** — id, tenant_id, funcao_id, setor_id, created_at
- **guia** — id, tenant_id, unidade_id, setor_id, funcao_id, codigo, titulo, descricao, ramo, frequencia, estado, created_at, updated_at, deleted_at, alcance, responsavel_executa, responsavel_supervisiona, materiais, revisao_meses, logo_ref, formato, estilo_ilustracao
- **guia_passo** — id, tenant_id, guia_id, ordem, descricao, media_ref, created_at
- **impressao_job** — id, tenant_id, unidade_id, equipamento_id, pedido_id, via, conteudo, status, tentativas, erro, criado_em, impresso_em
- **integracao** — id, tenant_id, unidade_id, canal, ativo, merchant_id, client_id, client_secret, token, config, updated_at, created_at
- **item_conversao** — id, tenant_id, item_id, unidade_de, fator, unidade_para, created_at
- **item_estoque** — id, tenant_id, unidade_id, nome, unidade_medida, estoque_minimo, categoria, created_at, updated_at, deleted_at, custo_medio, dias_seguranca, classe_abc, fornecedor_id, categoria_item_id, validade
- **janela_pico** — id, tenant_id, unidade_id, setor_id, dia_semana, hora_inicio, hora_fim, intensidade, created_at, updated_at, deleted_at, nome, dia_semana_fim
- **kds_alerta_config** — id, tenant_id, unidade_id, titulo, detalhe, prioridade, tipo, horarios, dias_semana, condicao, duracao_seg, ativo, criado_por, created_at, updated_at
- **kds_cor_config** — id, tenant_id, unidade_id, verde_ate_min, amarelo_ate_min, created_at, updated_at, usa_preparo, usa_entregue
- **lancamento_caixa** — id, tenant_id, unidade_id, titulo_id, tipo, valor, data, categoria, forma, descricao, estorno_de, criado_por_id, created_at, sessao_id, comanda_id
- **lote** — id, tenant_id, item_id, recebimento_id, validade, quantidade, entrada, esgotado, created_at, updated_at, deleted_at, custo_unitario

## Tabelas mesa → webhook_subscription

- **mesa** — id, tenant_id, unidade_id, numero, nome, status, modo, dono_id, aberta_em, aberta_por_id, fechada_em, fechada_por_id, created_at, equipamento_id
- **modulo_ativacao** — id, tenant_id, unidade_id, modulo, ativo, updated_at
- **movimento_estoque** — id, tenant_id, item_id, tipo, quantidade, motivo, data, created_at, custo_unitario, ref_tipo, ref_id
- **no_local** — id, tenant_id, unidade_id, identificador, versao, last_sync_at, status, created_at, updated_at *(registro do servidor local/edge)*
- **nota_fiscal** — id, tenant_id, unidade_id, comanda_id, modelo, serie, numero, chave, ambiente, status, protocolo, motivo, qrcode, xml, valor_total, emitida_por_id, emitida_em, cancelada_em, cancelada_por_id, justificativa_cancelamento, created_at
- **ocorrencia** — id, tenant_id, colaborador_id, tipo_id, autor_id, sinal, pontos, gravidade, descricao, foto_ref, setor_id, status, data, created_at, updated_at
- **opcao** — id, tenant_id, nome, codigo_pdv, descricao, imagem_ref, tipo, preco_custo, controla_estoque, ficha_id, item_id, produto_ref_id, ativo, esgotado, created_at, updated_at, deleted_at, padrao_marcada
- **opcao_destino_producao** — id, tenant_id, opcao_id, equipamento_id, created_at
- **ordem_producao** — id, tenant_id, unidade_id, ficha_id, item_saida_id, quantidade_planejada, quantidade_produzida, unidade, data_producao, hora_inicio, hora_fim, setor_id, funcao_id, colaborador_id, status, iniciada_em, concluida_em, concluida_por_id, motivo, obs, ref_id, canais, kds_equipamento_id, impressora_id, tarefa_instancia_id, tarefa_def_id, criado_por_id, created_at, updated_at, deleted_at
- **pagamento_tef** — id, tenant_id, unidade_id, comanda_id, valor, forma, parcelas, status, nsu, autorizacao, bandeira, provedor, mensagem, criado_por_id, criado_em, processado_em, cancelado_em
- **pedido_externo** — id, tenant_id, unidade_id, canal, external_id, display_id, cliente_nome, cliente_telefone, tipo, endereco, itens, total, forma_pagamento, status, comanda_id, raw, criado_em, confirmado_em, pronto_em, despachado_em, concluido_em, cancelado_em, motivo_cancelamento, taxa_entrega, cupom, desconto, troco_para, pago, status_pagamento, agendamento, profissional, cnpj, endereco_rua, endereco_numero, endereco_referencia, endereco_bairro, cliente_telefone2, bandeira, entregador_id, entregador_nome, auto_aceite_falhou, alterado, alterado_em, entregador_telefone, numero, cliente_id, client_ref, updated_at, gateway_payment_id, gateway_provider, deleted_at, estoque_reaproveitado, pago_online, retirada_tipo, caixa_sessao_id, atendente_id, entregue_em, avisado_pronto_em, despacho_token
- **pedido_manutencao** — id, tenant_id, unidade_id, equipamento_id, equipamento_ref, titulo, descricao, fotos, prioridade, status, criado_por_id, responsavel_id, delegado_em, prazo_15d, alerta_15d_em, decisao_15d, resolvido_em, resolvido_por_id, motivo, created_at, updated_at, deleted_at
- **perfil_acesso** — id, tenant_id, nome, nivel, login_web, permissoes, created_at, updated_at
- **ponto_ajuste** — id, tenant_id, colaborador_id, data, tipo, marcacao_id, minutos, justificativa, atestado_ref, autor_id, created_at
- **ponto_fechamento** — id, tenant_id, competencia, status, total_colaboradores, total_pendencias, pendencias, pdf_ref, enviado_em, enviado_contador_id, enviado_por_id, criado_em, updated_at *(mig 164 — fechamento mensal / espelho RH)*
- **ponto_marcacao** — id, tenant_id, unidade_id, colaborador_id, nsr, tipo, marcado_em, origem, registrado_por_id, hash, obs, created_at, equipamento_id, foto_ref, consentimento_lgpd, data_expurgo
- **pop** — id, tenant_id, checklist_id, versao, conteudo_snapshot, publicado_em, pdf_ref, created_at, updated_at
- **producao_pedido** — id, tenant_id, unidade_id, comanda_id, destino_equipamento_id, destino_tipo, setor_id, numero, origem, mesa, status, tempo_preparo_min, criado_em, iniciado_em, pronto_em, entregue_em, cancelado_em, cancelado_por_id, obs, created_at, senha, plataforma, senha_plataforma, updated_at
- **producao_pedido_item** — id, tenant_id, pedido_id, comanda_item_id, descricao, quantidade, complementos_texto, status, observacao, updated_at
- **produto** — id, tenant_id, unidade_id, codigo, nome, descricao, categoria_id, ficha_id, tipo, unidade_medida, preco_venda, preco_custo, controla_estoque, validade_dias, vai_para_producao, setor_producao_id, imagem_ref, ativo, created_at, updated_at, deleted_at, tempo_preparo_min, ncm, cfop, cest, origem, csosn, cst_icms, unidade_trib, aliq_icms, preco_promocional, selos, disponivel_cardapio, venda_multiplo, duracao_min, gtin, cst_pis, aliq_pis, cst_cofins, aliq_cofins, destaque, disponivel_balcao, pausado_estoque, pausa_motivo, permite_negativo, controla_validade, validade_fechado_dias, validade_aberto_dias, item_id, canais_pausados
- **produto_combo_item** — id, tenant_id, combo_produto_id, componente_produto_id, quantidade
- **produto_complemento** — id, tenant_id, produto_id, complemento_id, ordem, created_at, updated_at, deleted_at
- **produto_destino_producao** — id, tenant_id, produto_id, equipamento_id, created_at
- **produto_faixa_preco** — id, tenant_id, produto_id, qtd_min, preco, ordem
- **produto_sugestao** — id, tenant_id, produto_id, sugerido_id, ordem, created_at
- **produto_variacao** — id, tenant_id, produto_id, nome, codigo, preco_venda, fator_ficha, ativo, created_at, atributos
- **recebimento** — id, tenant_id, unidade_id, fornecedor_id, data, nota_ref, nota_foto_ref, status, obs, conferido_em, conferido_por_id, created_at, updated_at, deleted_at, vencimento
- **recebimento_item** — id, tenant_id, recebimento_id, item_id, qtd_esperada, qtd_recebida, divergencia, validade, foto_ref, obs, created_at, custo_unitario
- **revenda** — id, nome, ativo, criado_em
- **senha_contador** — id, tenant_id, unidade_id, valor, periodo, ultimo_reset, updated_at
- **setor** — id, tenant_id, unidade_id, nome, icone, created_at, updated_at, deleted_at, cor
- **setor_destino_producao** — id, tenant_id, setor_id, equipamento_id, created_at
- **tarefa_def** — id, tenant_id, unidade_id, setor_id, origem, checklist_id, titulo, descricao, etiqueta_id, colaborador_override_id, recorrencia_tipo, recorrencia_config, horario, janela_turno_id, proibida_no_pico, antecipavel, pop_id, created_at, updated_at, deleted_at, funcao_id
- **tarefa_instancia** — id, tenant_id, unidade_id, tarefa_def_id, data, etiqueta_id, colaborador_resolvido_id, estado, motivo, foto_ref, concluido_por_id, concluido_em, conclusao_em_massa, justificativa_pico, created_at, updated_at, deleted_at, funcao_id, setor_id, fotos, data_expurgo
- **tef_config** — id, tenant_id, unidade_id, ativo, provedor, terminal_id, created_at, updated_at
- **telemetria_evento** — id, tenant_id, unidade_id, origem, nivel, tipo, mensagem, hash, stack, contexto, versao, fingerprint, ocorrencias, primeiro_em, ultimo_em, resolvido
- **tipo_ocorrencia** — id, tenant_id, nome, sinal, pontos, ativo, created_at, updated_at, deleted_at
- **titulo_financeiro** — id, tenant_id, unidade_id, tipo, descricao, fornecedor_id, valor, vencimento, status, origem, origem_id, criado_por_id, created_at, categoria, recorrencia, foto_ref
- **turno** — id, tenant_id, unidade_id, setor_id, nome, hora_inicio, hora_fim, created_at, updated_at, deleted_at, modelo, tipo, intervalo_previsto, pausa_inicio, pausa_fim
- **unidade** — id, tenant_id, nome, endereco, timezone, created_at, updated_at, deleted_at, limite_diferenca_caixa, tipo
- **usuario_distribuicao** — id, nome, email, senha_hash, perfil, ativo, criado_em, atualizado_em
- **vistoria** — id, tenant_id, unidade_id, setor_id, colaborador_id, tipo, data, observacao, foto_ref, status, created_at, updated_at, deleted_at
- **webhook_subscription** — id, tenant_id, evento, url, secret, status, created_at, updated_at
