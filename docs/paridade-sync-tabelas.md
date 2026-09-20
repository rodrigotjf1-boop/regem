# Paridade local ↔ nuvem — mapa das tabelas

> **Princípio (decisão do dono, 19/09/2026):** o banco da loja e o da nuvem têm de estar
> sincronizados. Há dado que nasce na nuvem e desce, e dado que nasce na loja e sobe. Com
> paridade, perder o computador não é perder dado — o servidor local existe pela agilidade
> (impressoras, ponto, PDVs conversando na LAN, menos carga na API da nuvem) e para operar
> quando a internet cai, não para ser um depósito exclusivo.
>
> **Regra de decisão** desta página, nesta ordem:
> 1. contém segredo, credencial, telemetria, licença ou dado de outra loja → **só-nuvem**;
> 2. é fila/estado da máquina ou valor recalculável → **descartável**;
> 3. o resto é dado de negócio da loja e **tem de sincronizar** — `desce`, `sobe` ou `ambos`.
>
> Levantado por varredura do código em 19/09/2026 (`origin/main` = `8867838`), com o banco
> do servidor local montado do zero a partir das migrations (`EDGE_MODE=true`): **146
> tabelas com `tenant_id`**, das quais 43 sobem hoje.

## 1. Como a trava funciona (já implementada)

`sync-daemon.mjs --pendencias` (e o `--descarregar`, que o instalador roda antes de apagar
o banco) varre o banco local e exige que **toda** tabela com `tenant_id` e pelo menos uma
linha esteja em uma destas situações:

| Situação | Onde está declarada | Efeito |
|---|---|---|
| Sobe para a nuvem | `PUSH_TABLES` (`backend/edge/sync-daemon.mjs`) | o `--descarregar` acabou de enviar |
| Volta da nuvem | `VOLTA_DA_NUVEM` (idem) | apagar é seguro: o pull rebaixa |
| Descartável | `DESCARTAVEL` (idem) | fila/estado da máquina ou recalculável |

Qualquer outra tabela com dado **bloqueia o apagamento** (código de saída 3) e é listada
pelo nome. A regra é propositalmente ao contrário de uma lista de proibidas: **tabela nova
que ninguém classificou trava a reinstalação em vez de ser apagada em silêncio.**
Guardado por `backend/src/modules/sync/pendencias-wipe.spec.ts`.

## 2. Classificação

### 2.1 Já sincronizam (43 tabelas)

Ver `backend/src/modules/sync/sync-config.ts`. Não repetidas aqui.

### 2.2 Descartáveis — apagar não perde informação

| Tabela | Por quê |
|---|---|
| `impressao_job` | Fila de impressão **desta** máquina, com reserva por lease. Descer de volta faria a impressora repetir pedido antigo e quebraria a guarda anti-reimpressão. |
| `impressao_edge_feito` | Marcador anti-reprocessamento local. Não tem `id` nem `tenant_id`. Se viesse de fora, marcaria como impressa uma comanda que nunca saiu. |
| `impressora_status` | Estado de operação da impressora (última impressão, falhas seguidas). A própria migration 269 declara que não entra no sync. |
| `sync_marcador` | Infraestrutura do próprio sincronismo. Sincronizá-lo corromperia o pull (o marcador de um lado sobrescreveria o do outro). |
| `edge_status` | Telemetria de frota; no banco da loja a tabela existe vazia. |
| `sync_exclusao` | Aviso de exclusão; sobe e é consumido. |
| `cardapio_senha_seq` | Contador de senha do canal online, só usado na nuvem. |
| `senha_contador` | **Gerador de sequência com trava.** Sincronizar por última-escrita-vence faria o contador andar para trás e a loja emitir senha duplicada. Ver §4. |
| `estoque_snapshot` | Derivado de `movimento_estoque` + custo médio, que já sincronizam. Ver §4. |
| `no_local` | Tabela morta (o conceito virou `equipamento` tipo `servidor_local`). |

### 2.3 Só-nuvem — nunca descem (regra de distribuição)

`api_client`, `webhook_subscription` (guardam segredo), `integracao`, `integracao_token`
(credencial de marketplace/gateway/n8n), `ativacao`, `revenda`, `reautorizacao_edge`,
`cadastro_pendente` (licença, 2º fator, anti-clone), `edge_heartbeat` (telemetria de frota),
`suporte_sessao` (console de distribuição), `campanha`, `campanha_envio`, `marketing_optout`,
`whatsapp_template`, `whatsapp_numero` (credencial Meta), `cliente_otp` (segredo de login),
`cliente_link`, `cardapio_evento`, `pedido_notificacao`, `bot_atendimento` e as onze
`entregador_*` (o app do entregador fala com a nuvem pela internet, não com a LAN da loja).

### 2.4 Entraram no sincronismo (migrations 272/273)

Passaram a sincronizar, com a coluna de data e os gatilhos que faltavam: `nota_fiscal` (sobe), `tarefa_def`, `checklist`, `checklist_item`, `pop`, `documento_controlado`, `ciencia`, `vistoria`, `ocorrencia`, `ponto_ajuste`, `guia`, `guia_passo`, `comunicado`, `comunicado_leitura`, as três de clima, `escala_regra`, `dia_especial`, `entitlement`, `janela_pico`, `contador`, `funcao_setor`, `colaborador_funcao`, `modulo_ativacao`, `categoria_item`, `item_fornecedor`, `item_conversao`, `forma_pagamento`, `comanda_pagamento`, `ordem_producao`, `mesa`, `alerta_estoque`, `produto_sugestao`, `produto_faixa_preco`, as quatro de destino de produção, `kds_cor_config`, `tef_config`, `pagamento_tef` (sobe), `cupom`, `cupom_uso`, `encomenda_regra_sinal`, `encomenda_recorrencia`, `banner`, `acerto_subpdv`, `pedido_manutencao` e `atendimento_chamado`.

**Ainda bloqueiam a reinstalação** (cada uma com fase própria, abaixo): `escala_alocacao` e `tarefa_instancia` (esperam a chave única de negócio), `cashback_*` e `fidelidade_*` (§3), `cliente_endereco` e `cardapio_bairro` (§4.6) e `fiscal_config` (§4.1).

### 2.5 Fila de trabalho — referência completa

> As linhas marcadas como feitas em §2.4 já entraram (migrations 272/273). O restante segue valendo.

Esta é a lista de trabalho. "Migration" indica o que falta para a tabela **poder** entrar no
sincronismo — quase sempre uma coluna de data que sirva de marca-d'água.

| Tabela | Direção | Migration necessária | Por que importa |
|---|---|---|---|
| `nota_fiscal` | sobe | `updated_at` + gatilho | NFC-e emitida no PDV local. Hoje só existe na loja; a guarda de 5 anos mora num PC sem backup. Sem cursor de atualização, a nota subiria eternamente "pendente". |
| `tarefa_def`, `tarefa_instancia` | ambos | — (ver §4) | Tarefa delegada na gestão e executada na ponta. |
| `checklist`, `checklist_item`, `pop` | ambos | gatilho de exclusão em `checklist_item` | Item apagado ressuscita sem o gatilho. |
| `escala_alocacao` | ambos | — | Escala planejada na gestão, presença marcada na loja. |
| `escala_regra` | ambos | gatilho de carimbo | Sem ele, edição futura some do delta. |
| `dia_especial` | ambos | `updated_at` + gatilho | Só tem data de criação: edição e exclusão nunca sincronizariam. |
| `vistoria`, `ocorrencia` | ambos | — | Nascem na ponta e no fechamento de caixa. |
| `ponto_ajuste` | ambos | — | Abono/atestado é ato de gestão que o espelho local precisa ver. |
| `documento_controlado`, `ciencia` | ambos | `created_at` em `ciencia` | Ciência é prova de treinamento. |
| `guia`, `guia_passo` | ambos | gatilho de exclusão em `guia_passo` | Regravado por apagar e reinserir. |
| `comunicado`, `comunicado_leitura` | ambos | `updated_at` / `created_at` | Despublicar e fixar não chegam do outro lado. |
| `clima_pesquisa`, `clima_resposta`, `clima_participacao` | ambos | `updated_at` / `created_at` | A participação é a trava de voto duplo. Resposta é anônima por desenho. |
| `entitlement`, `janela_pico` | ambos | — | Toggles e configuração de pico, editados dos dois lados. |
| `funcao_setor`, `colaborador_funcao` | desce | gatilho de exclusão | Vínculo removido ressuscita sem o gatilho. |
| `modulo_ativacao` | desce | — | O edge precisa ler para cortar acesso offline, mas nunca escrever (senão reativa por última-escrita o que a nuvem desligou). |
| `item_fornecedor`, `categoria_item`, `item_conversao` | ambos | gatilho de exclusão; carimbo | Cadastro de insumo; sem conversão, o recebimento calcula quantidade errada. |
| `forma_pagamento` | ambos | `updated_at` + gatilho | É cadastro-mãe do caixa; hoje loja e nuvem têm listas diferentes. |
| `comanda_pagamento` | ambos (append) | — | Sem ela, o Financeiro na nuvem não vê como a conta foi dividida. |
| `ordem_producao` | ambos | carimbo/exclusão | Documento de produção que muda de estado. |
| `mesa` | ambos | `updated_at` + gatilho | A nuvem vê a comanda, mas não a mesa que a agrupa. |
| `alerta_estoque` | ambos | `updated_at` | Alerta resolvido na loja fica aberto para sempre na nuvem. |
| `produto_sugestao`, `produto_faixa_preco` | ambos | cursor (faixa não tem data nenhuma) | Sem a faixa, o PDV local cobra preço cheio no atacado. |
| `produto_destino_producao`, `setor_destino_producao`, `complemento_destino_producao`, `opcao_destino_producao` | ambos | incluir `kds` no filtro de `equipamento` (ver §4) | Roteamento de impressão e KDS. |
| `kds_cor_config`, `tef_config` | ambos | gatilho | Configuração espelhada, como impressora e cupom. |
| `pagamento_tef` | sobe | `updated_at` | Comprovante (NSU/autorização) nascido no terminal da loja. |
| `fiscal_config` | desce, **sem** `proximo_numero` | gatilho + redação da coluna | O edge precisa do certificado para emitir offline, mas o contador é por lado. Ver §4. |
| `cupom`, `cupom_uso` | desce / ambos | `updated_at`; gatilho de exclusão | Hoje o PDV local nem consegue validar cupom, e o estorno feito na loja não devolve o uso. |
| `encomenda_regra_sinal`, `encomenda_recorrencia` | desce | `updated_at` na recorrência | A loja precisa cobrar o sinal e produzir a assinatura. |
| `banner` | desce | gatilho de exclusão | Só importa se o edge servir cardápio/totem. |
| `cliente_endereco` | ambos | `updated_at` + rota no edge (ver §4) | Sem ela, o atendente redigita o endereço a cada pedido. |
| `cardapio_bairro` | ambos | tabela **sem data nenhuma** | Sem internet, o frete por bairro não é recalculado: cobrança errada, silenciosa. |
| `acerto_subpdv` | ambos | gatilho recomendado | Dinheiro pendente do garçom. |
| `pedido_manutencao` | ambos | gatilho recomendado | Nasce na loja; o C&O delega na nuvem, e a delegação não volta. |
| `contador` | ambos | gatilho recomendado | Cadastro do contabilista (destino do relatório de ponto). |
| `cashback_saldo`, `cashback_movimento`, `cashback_vale`, `fidelidade_cliente`, `fidelidade_ponto`, `fidelidade_resgate` | ambos | `updated_at` em 4 delas | **É dinheiro do cliente.** Ver §3. |
| `cashback_plano`, `cashback_produto_valor`, `fidelidade_plano` | desce | `updated_at` | Plano criado na loja não existe para o cliente; editado na nuvem não chega à loja. |
| `colaborador_unidade`, `equipe`, `equipe_membro`, `ausencia` | desce | cursor em duas delas | Tabelas da fundação, hoje sem nenhum código que escreva. |
| `ponto_fechamento` | desce | guarda para o cálculo só rodar na nuvem | Ver §4. |
| `atendimento_chamado` | ambos | `atualizado_em` | Nasce na nuvem e é resolvido na loja; o "resolvido" não volta. |

## 3. Dinheiro do cliente — cashback e fidelidade (RESOLVIDO na mig 274)

> **Feito em 20/09/2026.** As nove tabelas passaram a sincronizar e o saldo virou CACHE: ele é
> recalculado por gatilho a partir do extrato, que só anexa e não tem conflito. Número
> sincronizado por última-escrita-vence faria um crédito apagar o outro.
>
> - `cashback_movimento`, `cashback_vale`, `cashback_plano`, `cashback_produto_valor`,
>   `fidelidade_plano`, `fidelidade_ponto`, `fidelidade_resgate` e a nova `fidelidade_ajuste`: sincronizam.
> - `cashback_saldo` e `fidelidade_cliente`: **não** sincronizam — são recalculados.
> - O **ajuste manual de pontos** virou lançamento próprio (`fidelidade_ajuste`): antes era
>   escrito direto no número, não aparecia em lugar nenhum e sumiria no recálculo.
> - **Medido na produção antes de aplicar:** 2.428 saldos, 1 divergência real (R$ 3,06 de um crédito
>   apagado por gravação concorrente) e o resto poeira de ponto flutuante. A migration corrige de uma vez.
> - Dois defeitos que o gatilho criaria foram corrigidos junto: o serviço somava o crédito
>   de novo depois do gatilho (R$ 10 viravam R$ 20) e o prêmio saía um ponto antes da meta.

### 3.1 O diagnóstico que levou a isso


O crédito de cashback acontece **nos dois lados** (o painel de delivery roda no servidor
local), mas o **débito só existe na nuvem** (cardápio online). Como nenhuma das nove tabelas
sincroniza:

1. o cashback creditado num pedido atendido na loja **não existe** para o cliente — ele nunca
   consegue gastar, e os relatórios da loja e da nuvem divergem;
2. o **estorno** de um pedido cancelado na loja não chega à nuvem: o cliente fica com o
   cashback de um pedido cancelado e pode gastá-lo;
3. um prêmio marcado como usado de um lado continua disponível do outro — **uso duplo**;
4. plano de fidelidade criado no servidor local nunca aparece para o cliente, sem erro nenhum.

**Ressalva de desenho:** `cashback_saldo` é saldo materializado. Sincronizá-lo por
última-escrita-vence faz um crédito sobrescrever o outro. O caminho correto é sincronizar
`cashback_movimento` como razão (append-only, igual ao estoque) e **recalcular** o saldo.

## 4. Decisões que precisam do dono antes da implementação

1. **`fiscal_config.proximo_numero`** — hoje nuvem e loja emitem com a mesma série e
   numeração independente, o que a SEFAZ rejeita por duplicidade. É um problema **anterior**
   ao sync. Saídas: série distinta por origem, ou emissão fiscal exclusiva de um lado.
2. **`senha_contador`** — **RESOLVIDO na mig 275: prefixo por origem** (balcão `B-12`, delivery
   `D-07`). Cada origem numera a própria sequência, então não há nada a coordenar entre a loja
   e a nuvem — a duplicidade fica impossível por construção, inclusive com a internet caída
   (era exatamente quando acontecia: o PDV seguia no balcão e a nuvem assumia o delivery após
   3 minutos, e os dois chegavam ao mesmo número). O contador passou a ser por (empresa, loja,
   origem) e `comanda`/`producao_pedido` guardam de onde veio a senha; o contador em si segue
   fora do sincronismo, porque é sequência de máquina.
3. **`ponto_fechamento`** — o cron mensal roda nos dois lados, sem guarda. No servidor local
   ele calcularia sobre a janela de espelho (60 dias) e produziria um fechamento incompleto
   que venceria por última-escrita. Precisa de guarda antes de qualquer sincronismo.
4. **`estoque_snapshot`** — recalculável, mas o custo médio usado é o atual, não o da data.
   Ou aceita-se divergência de custo histórico, ou a tabela passa a descer da nuvem.
5. **`tarefa_instancia` e `escala_alocacao`** — são materializadas por rotina nos dois lados.
   Sem uma chave única de negócio, sincronizar **duplica** em vez de conciliar.
6. **`cliente_endereco` e `cardapio_bairro`** — **RESOLVIDO na mig 276.** As duas passaram a
   sincronizar **e** a busca por telefone ganhou rota no módulo do Delivery, que é servido no
   servidor local (o módulo de clientes só existe na nuvem: a tela levava 404 e o erro era
   engolido em silêncio). Agora o atendente digita o telefone e vêm nome e endereços mesmo sem
   internet, e o frete por bairro volta a ser recalculado na loja — antes o pedido corrigido
   saía com a taxa antiga ou zero.
7. **`ativacao`** — o plano contratado é lido no edge, mas a tabela nunca é populada, então
   **o plano não limita nada na loja**. Ela não deve descer (carrega segredo): o certo é
   descer um derivado (lista de módulos do plano) junto com `empresa`.
8. **Volume** — com a paridade, a loja passa a guardar mais coisa. Recomendo o padrão do
   mercado: **a loja mantém os últimos meses de movimento, a nuvem guarda o histórico
   inteiro** (já existe a janela de espelho, `mirror_dias`).
9. **Filtro de `equipamento`** — o filtro atual exclui o tipo `kds`. Sincronizar as tabelas de
   destino de produção sem incluir `kds` mataria cada linha por chave estrangeira no outro
   lado.

## 5. Achados laterais (fora do sincronismo)

- `cadastro_pendente` é só-nuvem, mas três rotas públicas de cadastro não são marcadas como
  tal: um POST contra o servidor local devolve erro 500 (tabela inexistente).
- `integracao_token` está declarada no schema, mas **nenhuma migration a cria** e nenhum
  código a usa.
- O botão "revogar acesso do suporte" não tem efeito quando acionado no servidor local: a
  tabela existe vazia lá.
