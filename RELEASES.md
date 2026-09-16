# RELEASES — fonte da verdade do que é empacotado/distribuído

> Instalador (`.exe`) e atualização (`.zip`) do **edge**, e **APKs**. **Consulte antes de gerar** qualquer artefato e **atualize ao mesclar** cada PR com mudança distribuível. Regras completas em `CLAUDE.md` › "Releases".

## Regras rápidas

- **Acumular, não empacotar a cada alteração.** Em criação/testes/correção, registre a pendência aqui e junte. Só **cortar release** (gerar `.zip`/`.exe`/`.apk`) quando acumular vários PRs **ou o usuário pedir**.
- **`.zip`** (atualização de backend/edge, não-destrutivo): a cada corte com mudança de backend/edge.
- **`.exe`** (instalador, reinstala limpo): só se tocou **`sync`/`edge`** (scripts `backend/edge/*`, `sync-config`/`sync-daemon`, deps embutidas, `.iss`) ou para manter instalação nova na versão corrente. Sai **sempre versionado** com o `AppVer` do `regem-edge.iss`.
- **Como cortar (OBRIGATÓRIO):** `powershell -File backend\edge\build-release.ps1 -Versao X.Y.Z` → só compilar no Inno / rodar `publicar.ps1` no **"TUDO OK"** do preflight. Nunca de árvore atrás do `origin/main`, nunca de `regem-edge-dist` reaproveitado.
- **Publicar `.zip`:** `edge/publicar.ps1` → sobe no Supabase Storage (bucket `edge-updates`, nome exato `regem-edge-X.Y.Z.zip`) → publica no console de distribuição.

## Acumulado (NÃO empacotado) — próximo `.exe`/`.zip` do edge

Mudanças **do edge** já na `main` aguardando o próximo corte:
- **Impressão de teste nuvem→local (`sync-daemon.mjs`):** novo comando remoto `testar_impressora` — a nuvem enfileira em `edge_comando`, o edge imprime um teste em TODAS as impressoras locais (fila `impressao_job`). Tocou `sync-daemon` → **`.zip` + `.exe`**. Cloud (autodeploy): `enfileirarTeste` com edge ativo passa a disparar o comando em vez do aviso F10.
- **Épico melhorias Delivery (split de pagamento):** o **PDV do edge** recebe pagamento de retirada/encomenda dividido em várias formas → grava em `pedido_externo_pagamento` (**migration 230**, NÃO cloud-only — precisa existir no edge). O backend do delivery (`delivery.service`) roda no edge → **`.zip`**. As demais frentes do épico (cupons/fidelidade/cashback/horário/área-OSRM/marketing/whatsapp/entregadores) são **cloud-only** (autodeploy).
- **Tarefas — horário final + prioridade + criador (#478):** `tarefa_def` ganha `horario_fim`/`prioridade`/`criado_por_id`/`criado_por_nivel` (**migration 235**, NÃO cloud-only — Meu Dia roda offline no edge; nuvem ✓ 10/09). Só schema aditivo — sem tocar `sync`/`edge` → basta **`.zip`** para o edge conhecer as colunas novas (o front/back de gestão é autodeploy).
- **WhatsApp avisos de status na oficial (#480 Frente A + #481 Frente B):** `whatsapp_template` += `evento` (**migration 236**, NÃO cloud-only — o `whatsapp_template` existe no edge). O **roteador de aviso** em `delivery.service` (Evolution → WhatsApp como hoje; oficial → n8n se o cliente já conversou, senão notificação in-app) roda no edge → **`.zip`** para o edge conhecer a coluna nova e o novo roteamento. A tabela **`pedido_notificacao` (migration 237) é CLOUD-ONLY** (`-- @cloud-only`) — o edge pula (o cliente acompanha na nuvem). O catálogo de utilidade/seed/endpoints do cliente é autodeploy.

- **Valores do pedido separados por origem (#502):** `pedido_externo` ganha 9 colunas (**migration 241**, NÃO cloud-only — `pedido_externo` existe no edge desde a mig 039 e o delivery roda lá; nuvem ✓ 13/09): `valor_bruto`, `desconto_loja`, `desconto_marketplace`, `descontos` (jsonb), `pagamentos` (jsonb), `taxa_entrega_dono`, `valor_pago_cliente`, `taxas_extras`, `taxas_extras_detalhe`. Os adaptadores de canal (`adapters.ts`) e o `ingest` do `delivery.service` rodam no edge → **`.zip`** para ele conhecer as colunas novas e gravar o detalhe. ⚠️ O sync descobre coluna nova sozinho (`information_schema`), mas **enquanto o edge não receber o `.zip` ele opera só com os campos antigos** — o pedido criado lá não terá o detalhe de desconto. Sem tocar `sync`/`edge` scripts → **não precisa de `.exe` novo**.

- **Faturamento unificado + NFC-e com frete/desconto + rateio nos itens:** **sem migration**. Toca três coisas que rodam no **edge** → **`.zip`**:
  1. **NFC-e (`nfce-xml.builder.ts` + `fiscal.service.ts`)** — a nota passa a declarar `vFrete` e `vDesc` (antes saíam sempre `0.00`), **rateados por item em centavos** porque a SEFAZ valida que o total é o somatório dos `det` (regras W14-10/W16-10). `vNF` e `vPag` acompanham; `modFrete` vira `0` quando há frete. Os valores vêm do `pedido_externo` vinculado à comanda (só o frete que é **da loja** e o desconto que a **loja** bancou). Base do PIS/COFINS passa a ser a líquida. Se a base do edge ainda não tiver as colunas da mig 241, o serviço cai no comportamento antigo (frete/desconto 0) em vez de falhar.
  2. **Cardápio próprio (`cardapio.service.ts` + `adapters.ts`)** — o checkout passa a gravar o detalhe por origem (cupom / resgate de fidelidade / cashback / frete grátis) nas colunas da mig 241. Era o **único canal** que ficava com desconto zero em todos os relatórios.
  3. **App do entregador (`entregador.service.ts` + `cobranca.ts`)** — "a receber" calculado do detalhe de pagamento (resolve pré-pago de marketplace e pagamento dividido) + troco.
  O resto (relatórios, painel, Visão C&O e a tela do entregador em Flutter) é **cloud/APK**, não entra no `.zip`. ⚠️ **Enquanto o edge não receber o `.zip`, a NFC-e emitida lá continua sem frete e sem desconto** e o pedido do cardápio criado no edge não grava o detalhe por origem. Sem tocar `sync`/`edge` scripts → **não precisa de `.exe` novo**.

- 🔴 **Estoque no edge — cadeia da ficha + ledger completo (migration 242, NÃO cloud-only):** dois defeitos que juntos faziam o **módulo de estoque não funcionar no servidor local**.
  1. **`ficha_ingrediente`, `produto_variacao` e `produto_combo_item` nunca estiveram na whitelist do sync.** A explosão de ficha lê exatamente essas três tabelas → no edge a ficha descia VAZIA, a venda não gerava movimento nenhum, e como `consumo` vazio é tratado como "ilimitado", **nada nunca esgotava**. Elas não tinham `updated_at` nem `deleted_at`, e a ficha é salva por `delete + insert` — só adicioná-las à whitelist trocaria "baixa zero" por "baixa duplicada". A **mig 242** dá às três o contrato das demais tabelas sincronizadas (cursor + soft-delete) e os serviços passaram a excluir por `deleted_at`.
  2. **`movimento_estoque` estava na janela `mirror_dias` (60 dias).** O saldo é a SOMA DE TODO O LEDGER e não há saldo materializado → o edge nascia com saldo errado pelo tamanho do histórico cortado (no banco de dev, 505 dos 509 movimentos estavam fora da janela). Removido da janela — vale para o pull contínuo **e** para o snapshot do restore.
  **`.zip` necessário** por dois motivos: (a) o edge precisa da mig 242 para reconhecer `deleted_at` — sem ela o servidor local recebe a linha excluída como viva e passa a baixar insumo a mais depois de cada edição de ficha; (b) `sync-daemon.mjs` ganhou `repararCursores` (marca `reparo_ledger_completo_v1`), que rebobina UMA VEZ o cursor de `movimento_estoque` para o edge rebaixar o histórico — sem isso, edge já instalado nunca busca o ledger anterior à janela. Não tocou `sync-config`/instalador → **não precisa de `.exe` novo**.
  ⚠️ **Ordem de deploy:** a mig 242 tem de estar na NUVEM **antes** do merge (o Drizzle nomeia todas as colunas no `select`; sem elas, toda query nas três tabelas dá 42703 — foi o incidente da mig 239).

- 🔴 **Documentos de estoque sincronizam (migration 243, NÃO cloud-only):** `recebimento(_item)`, `lote`, `desperdicio`, `contagem_*` (4), `compra_lista/_item` e **`titulo_financeiro`** nunca estiveram em `TABELAS_SYNC`. Os módulos que as escrevem rodam no **edge**, então o documento criado na loja ficava só lá: o `movimento_estoque` subia (o saldo batia na nuvem), mas a ORIGEM sumia — entrava estoque sem dizer de qual nota, contagem ou perda. E a **conta a pagar ao fornecedor** criada por `recebimento.confirmar()` nunca chegava ao Financeiro da nuvem. A **mig 243** dá às 11 o contrato do sync transacional: `updated_at` onde faltava (5 tabelas), `created_at` onde não havia timestamp nenhum (2) e o gatilho `bump_updated_at` em todas (**10 das 11 não tinham gatilho** — sem ele a MUDANÇA DE ESTADO não propaga: contagem fechada e título pago ficariam invisíveis do outro lado, exatamente a razão escrita na mig 095).
  **`.zip` obrigatório para o lado que sobe:** a lista de push é HARDCODED em `sync-daemon.mjs` (`PUSH_TABLES`), separada da whitelist do backend — foi assim que as 11 ficaram de fora sem nada falhar. O pull (nuvem → edge) funciona só com o autodeploy; o push (edge → nuvem) só com o `.zip`. Um teste novo compara as duas listas e quebra o CI se voltarem a divergir. Não tocou instalador → **sem `.exe` novo**.
  ⚠️ **Ordem de deploy:** mig 243 na NUVEM **antes** do merge (mesmo motivo da 242).

- **Contagem com hora por item (migration 244, NÃO cloud-only):** `contagem_item` += `contado_em` + índice `(tenant_id, item_id, created_at)` em `movimento_estoque`. O `ContagemModule` é EDGE_CORE e `contagem_item` sincroniza desde a mig 243 → o edge precisa da coluna. Só schema aditivo + serviço, sem tocar `sync`/instalador → **`.zip`**, sem `.exe`.

- 🔴 **Ordem de produção — baixa subdimensionada e conclusão sem trava:** **sem migration**. `OrdemProducaoModule` e `ProducaoModule` são **EDGE_CORE** (a produção é executada na loja) → **`.zip`**. Dois defeitos que só somem no edge com o pacote novo: (a) a conclusão dividia a quantidade pelo `rendimento` da ficha **duas vezes** (uma no multiplicador da ordem, outra na explosão), então a baixa saía `rendimento` vezes menor — ficha de 1000 ml consumia 0,5 g em vez de 500 g; (b) `concluir()` não travava a linha e nunca gravava `ref_id` na criação, então `produzir()` sorteava uma referência nova por chamada e o índice único da mig 024 não barrava nada: **três conclusões simultâneas baixavam o estoque três vezes**. ⚠️ **Enquanto o edge não receber o `.zip`, a produção lançada na loja continua subdimensionada e o duplo-clique continua duplicando a baixa.** Junto: escopo por unidade em listar/relatório/conclusão (loja A não age mais em ordem da loja B) e datas de recorrência no fuso da operação em vez de UTC. Não tocou `sync`/`edge`/instalador → **sem `.exe` novo**.

- **Recebimento confere o dono do item/fornecedor/unidade:** **sem migration**. `RecebimentoModule` é **EDGE_CORE** (a nota é conferida na loja) → **`.zip`**. `itemId` e `fornecedorId` vinham do corpo do request validados só como UUID, sem conferência de tenant nem de unidade — e é o recebimento que cria movimento de estoque, lote e conta a pagar. Enquanto o edge não receber o `.zip`, a nota lançada na loja continua aceitando id de outro dono. Sem tocar `sync`/`edge`/instalador → **sem `.exe` novo**.
- 🔴 **Etiqueta de validade sincroniza (migration 245, NÃO cloud-only):** quarto furo da mesma classe das migs 242/243. `EtiquetaValidadeModule` é **EDGE_CORE** e `etiqueta_validade`/`etiqueta_template` nunca estiveram em `TABELAS_SYNC` — a etiqueta impressa na loja ficava só no servidor local. A mig 245 dá às duas o **gatilho `bump_updated_at`** (tinham `updated_at` desde a mig 136 e gatilho nenhum), sem o qual o ciclo `fechado → em_uso → baixado → vencido` não propagaria. **`.zip` obrigatório para o lado que sobe:** `PUSH_TABLES` do `sync-daemon.mjs` é hardcoded e separada da whitelist do backend — o pull funciona só com o autodeploy, o push só com o `.zip`. Junto: `GET /lotes` passa a filtrar por loja e a tela de validades para de esconder insumo de unidade nula. Não tocou `sync-config`-do-instalador nem o instalador → **sem `.exe` novo**.
  ⚠️ **Ordem de deploy:** a mig 245 não adiciona coluna (não causa 42703), então o código pode subir antes sem quebrar — mas **enquanto ela não estiver na nuvem, a mudança de estado feita na NUVEM não propaga** (o `updated_at` não bumpa) e o sync leva só as criações.

- 🔴 **Conferência da compra + identidade do lote (migration 246, NÃO cloud-only):** `ComprasModule` e `EtiquetaValidadeModule` são **EDGE_CORE** — a compra é conferida na loja → **`.zip`**. `compras.receber()` lançava no estoque a quantidade **PEDIDA**: pediu 10, chegaram 7, entravam 10, e o custo médio ponderado saía em cima disso. Agora exige conferência linha a linha (o endpoint não recebia corpo nenhum), com validade obrigatória — data ou **"indefinida"** explícita — e é daí que nasce o `lote`, agora com código do fabricante, fornecedor e unidade. ⚠️ **Enquanto o edge não receber o `.zip`, a compra recebida na loja continua entrando pela quantidade pedida e sem lote.** ⚠️ **O front e o back mudam JUNTOS** (o botão passou a mandar a conferência no corpo) — não adianta `.zip` sem o autodeploy nem o contrário. Não tocou `sync`/`edge`/instalador → **sem `.exe` novo**.
  ⚠️ **Ordem de deploy:** a mig 246 **adiciona colunas** em `compra_item`, `lote` e `etiqueta_validade` — o Drizzle nomeia todas no `select`, então sem ela toda query nas três dá 42703 (incidente da mig 239). **Nuvem ANTES do merge.** ✓ aplicada 16/09.

- **Compra recebida vira conta a pagar (migration 247, NÃO cloud-only):** `ComprasModule` é **EDGE_CORE** → **`.zip`**. `compras.receber()` entrava com a mercadoria e não gerava dívida — só o `recebimento` gerava, e aquele fluxo tem ZERO notas na base. O título usa o valor **CONFERIDO** (mig 246), e a data de pagamento vem da criação da lista, do recebimento (que vence a da criação) ou do prazo cadastrado do fornecedor. `compra_lista` ganha `vencimento`. ⚠️ **Enquanto o edge não receber o `.zip`, a compra recebida na loja continua sem gerar conta a pagar.** Sem tocar `sync`/`edge`/instalador → **sem `.exe` novo**.
  ⚠️ **Ordem de deploy:** a mig 247 **adiciona coluna** em `compra_lista` — sem ela, toda query na tabela dá 42703. **Nuvem ANTES do merge.**

- **Etiqueta de validade sai do lote:** **sem migration** (`etiqueta_validade.lote_id` veio na mig 246). `EtiquetaValidadeModule` é **EDGE_CORE** → **`.zip`**. Etiquetar insumo comprado exigia uma data FIXA no cadastro do insumo, que nunca serve — cada compra chega com validade diferente. O lote da conferência vira a quarta fonte, com a validade daquela entrega, e a etiqueta guarda o vínculo (recall alcança o que já foi aberto). A etiqueta continua sendo impressa por uma pessoa, na quantidade que ela digita. ⚠️ **Enquanto o edge não receber o `.zip`, a loja não consegue etiquetar a partir de lote.** Sem `.exe` novo.
- 🔴 **PVPS/FEFO: a baixa consome o lote (migration 248, NÃO cloud-only):** Vendas, Produção, Desperdício e Contagem são **EDGE_CORE** — a baixa acontece na loja → **`.zip`**. `lote.quantidade` nunca era decrementado, então o alerta de validade falava da mercadoria que CHEGOU, não da que ainda está lá. Tabela nova `movimento_lote` (append-only, sobe junto com o ledger): o saldo do lote é o que entrou menos a soma dela, nunca um campo mutável — `lote` sincroniza com LWW e um saldo mutável perderia baixa concorrente. **`.zip` obrigatório para o lado que sobe:** `PUSH_TABLES` do `sync-daemon.mjs` é hardcoded e separada da whitelist do backend. ⚠️ **Enquanto o edge não receber o `.zip`, a baixa feita na loja não consome lote e o alerta de validade continua mentindo.** Não tocou instalador → **sem `.exe` novo**.
  ⚠️ **Ordem de deploy:** a mig 248 cria TABELA nova. O runner do edge pula 42P01, mas na NUVEM ela precisa existir **antes do merge** — sem ela toda baixa de estoque estoura ao tentar inserir em `movimento_lote`.

- 🔴 **RBAC na leitura do estoque + quarta/quinta/sexta cópia do `hojeISO`:** **sem migration**. `EstoqueModule`, `EtiquetaValidadeModule`, `CardapioModule` e `DesligamentoModule` rodam no edge → **`.zip`**. Três `GET` do estoque não tinham decorator de permissão nenhum (o guard libera quando não há `@RequirePerm`), então qualquer autenticado — inclusive o perfil de execução, que tem `CRUD_NONE` — lia itens, custo médio e o ledger de movimentos. Junto: a guarda de deriva do `hojeISO` só via `function hojeISO` e deixou passar três cópias em forma arrow, duas delas em UTC (etiqueta de validade e desligamento). ⚠️ **Enquanto o edge não receber o `.zip`, a API local continua servindo o estoque sem checar permissão e a etiqueta impressa à noite continua saindo com um dia a mais de validade.** Sem `.exe` novo.
- **Etiqueta que vira perda baixa o estoque + guarda do ciclo da etiqueta:** **sem migration**. `EtiquetaValidadeModule` e `DesperdicioModule` são **EDGE_CORE** → **`.zip`**. A perda gravava o desperdício sem movimento de estoque e com quantidade "1" fixa; passa pelo `DesperdicioService` (custo, saída e consumo FEFO do lote), com a quantidade informada por quem registra. Etiqueta já consumida ou já perdida não aceita mais perda nem finalização, sob trava de linha. O controller passa a respeitar o pacote de permissões. ⚠️ **Front e back mudam juntos** (o botão de perda passou a pedir a quantidade). ⚠️ **Enquanto o edge não receber o `.zip`, a perda de etiqueta na loja continua sem baixar estoque.** Sem `.exe` novo.

> **OSRM Fase 0/1 (#417) é CLOUD-ONLY** (rota no rastreio do cliente + backend por autodeploy) — **NÃO** entra no `.exe`/`.zip` do edge; sobe por autodeploy. Precisa de `OSRM_URL` no `regem-api`.

> **Épico trava anti-clone + suporte + self-service C&O é CLOUD-ONLY** (backend + front por autodeploy) — **NÃO** entra no `.exe`/`.zip`. Frentes: cadeado no console /distribuicao; suporte com "acesso total" opcional (presidente concede em config/acessos); self-service do C&O em /servidor (cadastra app autenticador); **trava anti-clone ON por padrão após a 1ª instalação**. Precisa da **migration 224** na nuvem (`empresa.suporte_acesso_total`). _(E — nuvem→edge de suporte — adiada.)_

Cortar quando o gestor pedir: `build-release.ps1 -Versao X.Y.Z` de worktree off `origin/main` (que já terá o #416 + o branch mesclado).

## App do entregador (APK — fora do edge)

O app entregador **não** é `.exe`/`.zip` do edge — é **APK de instalação direta** (AAB/Play adiado "até estar mais completo"). Última versão na Play = `0.1.0` (versionCode 7). Acumulado desde então:
- **Localização em 2º plano (#419):** `getPositionStream` + foreground service → envia a cada 10s com a tela apagada; manifest += `ACCESS_BACKGROUND_LOCATION`/`FOREGROUND_SERVICE(_LOCATION)`.
- **Rota OSRM no mapa in-app (#427):** "Ver rota" desenha a NOSSA rota (OSRM) num `flutter_map` + ETA; botão "Navegar" abre Waze/Maps p/ a voz. Consome `POST /entregador/pedido/:id/rota` (#426, cloud/autodeploy).
- **Ganhos estimados (#430):** ao confirmar a entrega com código, a taxa (real/por entrega ou fixa, pelo perfil) já entra em "Meus ganhos estimados" (inclui 'entregue' pendente de conferência); cancelamento no atendimento abate sozinho. Backend `ganhos()` (cloud/autodeploy) + rótulo no app.
- **Visual moderno + marca (`+14`):** tema Regem coeso (Material 3, ouro/navy), monograma **R.O. em órbita**, nome "Regem / ENTREGADOR" no login e no topo; só layout.
- **Fila + máquina de estados do botão (Frentes 2b/2d, `+15`):** o botão vira `Entrar na fila` (geofence ~150m) → `Nº da fila` → `Procurar pedido` (só o 1º da fila) → `Iniciar entrega(s)` (roteiriza + avisa o 1º cliente) → `em entrega` (roteiro). **Scan do 1º da fila = modo carrinho** (reserva no batch, sem teto — o lote é alvo, não trava); fora da fila despacha na hora (retrocompatível). **Alerta de pronto:** som + haptic + banner quando surge pedido pronto e eu sou o 1º. Consome os endpoints de fila (cloud). ⚠️ **Push em 2º plano (tela apagada) = follow-up (FCM/Firebase).**

**Build de teste `0.1.0+15`** (03/09) para sideload em **`app-entregador/build/app/outputs/flutter-apk/app-release.apk`** (~65 MB, **release assinado com chave de debug** → instala direto; se não instalar por cima do anterior, **desinstalar** o app antes). **Convenção:** o APK fica no caminho padrão de build do Flutter — `app-entregador/build/app/outputs/flutter-apk/` (`app-release.apk` = último build) — **não** copiar pra Downloads nem criar pastas novas. **Play/AAB** só quando o app amadurecer (aí wire do `upload.jks` no `build.gradle.kts` + bump do versionCode).

> **Épico delivery-fila (Frentes 1–4) — lado NUVEM é autodeploy** (rastreio `/r/[token]` sem "Você"/"Parada X-Y" + casinha; fila do atendente em `/delivery`; ciclo/tempo por entrega; relatórios `/delivery/relatorios`; **fix do "Lote/entregador"** que voltava sozinho pra 2). **NÃO** entra no `.exe`/`.zip`. Precisa da **migration 223** na nuvem (`entregador_fila` + `pedido_externo.reservado_em`) — sem ela os endpoints de fila dão erro.

## F1/F2/F3 — ✅ cortado no 1.24.0 (31/08)

Programa **Gestão de Frota Edge** (`docs/plano-frota-edge.md`) — mesclado e **empacotado no 1.24.0**:
- **F1 — saúde da frota (#397/#398):** `sync-daemon.mjs` enriquece o heartbeat (`coletarSaude`/`statusServicosEDisco`/`fpEdge` + unidade). → **`.zip` + `.exe`** (tocou `sync-daemon`). Cloud: **migration 219** (`edge_heartbeat` += `unidade_id`/`fingerprint`/`saude`) — _aplicada na nuvem._
- **F2 — impressão por unidade (#401/#402):** `impressao-daemon.mjs` + processadores escopados por `EDGE_UNIDADE_ID` (matriz não imprime em filial). → **`.zip` + `.exe`** (tocou `impressao-daemon`). Cloud: só código.
- **F3 — trava de instalação anti-clone (#403/#404/#405):** `instalar-tudo.ps1` trata `reauthRequired` (2FA e-mail/TOTP) e move o edge rotacionando o token. → **`.exe`** (instalador). Cloud: **migration 220** (`ativacao` += `reauth_*` + `reautorizacao_edge`) — **⚠️ aplicar na nuvem** (código já deployado lê essas colunas). Console em `/frota` (autodeploy).

> Empacotado no **1.24.0** (abaixo). Migrations: **219 (F1)** e **220 (F3)** aplicadas na nuvem (31/08).

## Última release: `1.29.0` — cortada (03/09/2026), **.exe COMPILADO** ✅

`.exe` completo (**88 MB**) em `backend/edge/Output/RegemEdgeSetup.exe`, cortado de worktree off `origin/main` (`b0b2725`), preflight **"TUDO OK"**. Empacota tudo que estava acumulado + **2 fixes de incidente** (edge quebrava na instalação/operação):

- **Tratamento de erros no edge — Blocos 4/5 (#443):** sync push keyset composto `(cursor, id)` (fim da perda silenciosa) + reenvio linha-a-linha/dead-letter; handlers `unhandledRejection`/`uncaughtException` nos 3 daemons + NSSM `AppExit/AppThrottle/AppRestartDelay`; ACK do `print-agent` com retry.
- **Seed de cursor no restore + log carimbado (#444):** `sync-daemon.mjs`.
- **Robustez de impressão P0–P4** (claim/lease **mig 221**, já na nuvem) + **reimpressão QR (#416)**.
- 🔴 **FIX mig 222 (#445):** `delete from entregador_localizacao` ganhou guard `if exists` — a tabela é **cloud-only** e não existe no edge; o delete direto **ABORTAVA toda a instalação** (`42P01`).
- 🔴 **FIX backend ipv4first (#446):** `setDefaultResultOrder('ipv4first')` no `main.ts` — o backend não resolvia `api.dmsregem.com` no serviço Windows (IPv6 não rota) → quebrava a validação de licença. Mesmo fix que o `sync-daemon` já tinha desde a 1.22.

**Sem migration nova na nuvem** (222/223 já aplicadas; 221 já aplicada; ipv4first é código). O `.exe` reinstala limpo + re-sync. `.zip` (`publicar.ps1`) opcional para testar update por zip.

> **⚠️ Notas de corte (aprendido no 1.29.0):** (1) o `next build` do release **PENDURA no ambiente automatizado** por estado acumulado (processos/locks zumbis) — um **restart do PC limpa** e o build roda; NÃO é limite headless. (2) ISCC (Inno CLI, compila o `.exe` sem GUI) em `C:\Program Files\Inno Setup 7\ISCC.exe`. (3) O `bundle/` (node/pgsql/nssm, **975 MB**) **NÃO está no git** → no worktree usar **junction** de `C:\Regen\backend\edge\bundle` (senão o `.exe` sai ~16 MB SEM os binários — o `.iss` usa `skipifsourcedoesntexist` e pula em silêncio). Remover a junction com `.Delete()`/`rmdir` (NÃO recursivo) antes de apagar o worktree, senão apaga o bundle real.

## Última release: `1.26.0` — cortada (01/09/2026), **.exe COMPILADO** ✅ (SNAPSHOT)

**Restore por SNAPSHOT (arquivo)** substitui a paginação linha-a-linha (#411) — decisão do
gestor: o page-by-page não carregava local e era frágil (502/FK/cursor).
- **Nuvem (F1):** `GET /sync/snapshot` (escopo por tenant do token) streama todo o
  transacional da loja como **NDJSON gzip opaco** (Cloudflare-safe: `/sync/` no skip +
  stream escapa do 524). Deploy por **autodeploy** no merge.
- **Edge (F2):** `restaurarSnapshot()` baixa o arquivo e carrega numa **transação com FK
  desligada** (`session_replication_role=replica`) — sem ordem pai/filho, sem "sem pai (FK)";
  só commita com o `__fim`. O gatilho do restore chama **só** o snapshot (paginação removida).
- **`.exe`** = dist 1.24 (web.tar/backend íntegros) **+ daemon novo** + version 1.26.0;
  preflight OK; compilado no Inno (88 MB). Sem migration. **F1 precisa estar deployado** na
  nuvem antes de reinstalar/disparar (autodeploy).

## Release anterior: `1.25.0` — cortada (01/09/2026), .exe compilado

Fix do **restore** que destravou o edge (incidente potitjf, ~1 semana sem testes): o edge
ficava com snapshot velho — o transacional recente (pedidos ativos, vendas de hoje) não
descia; `Restaurar` imprimia "solicitada" e **nunca puxava**.
- **Causa (#409):** o restore fazia `push` (upload) **ANTES** de baixar → com a nuvem em 502
  + fila grande, segurava o download; e usava `restore_cursor` **adiantado** → concluía com 0.
- **Fix:** restore **baixa primeiro** (push best-effort no fim) + **sempre completo** (desde
  1970; o servidor limita à janela `mirror_dias`=60) + **log por página** (nunca mais cego).
- Só mudou `sync-daemon.mjs` → dist = 1.24.0 **+ daemon novo** (web.tar/backend idênticos).
  O `build-release` travou no `next build` (hang conhecido) → dist montado por
  reaproveitamento + **preflight OK** → `.exe` compilado no **Inno (`ISCC.exe`)** →
  `backend\edge\Output\RegemEdgeSetup.exe` (**88 MB**, AppVer 1.25.0).
- **Cloud:** nenhuma migration. **`.zip` a publicar** (`edge\publicar.ps1`) p/ os demais edges.
- **Trilha 2 (durável):** snapshot em arquivo (`docs/plano-snapshot-restore.md`) — implementado
  no código (não empacotado ainda; será o 1.26.0 após testes).

## Release anterior: `1.24.0` — cortada (31/08/2026), dist VERIFICADO

`build-release.ps1 -Versao 1.24.0` de **worktree off `origin/main`** (`e1c1c52`) — preflight **TUDO OK** (web.tar 26.7 MB c/ next, sync keyset+don't-abort, `version.txt == .iss == 1.24.0`). Dist em `C:\Regen\regem-edge-dist` + `.iss` carimbada. **`.exe` a compilar no Inno** (`backend\edge\regem-edge.iss` → `Output\RegemEdgeSetup.exe`); **`.zip` a publicar** (`edge\publicar.ps1`). **Superset do 1.23** — leva tudo:
- **sync (1.22):** `ipv4first` + `fetchT` retry (rede + 5xx GET) + `causaErro()` — fim do `fetch failed` cego; `reset-restore.ps1`.
- **sync (1.23):** restore acumula FK-órfão entre páginas + varredura final + `restore_progresso`.
- **F1** saúde da frota no heartbeat (#397/#398) — mig **219** (nuvem ✓).
- **F2** impressão por unidade (#401/#402) — matriz não imprime em filial.
- **F3** trava anti-clone + instalador trata re-auth 2FA e-mail/TOTP (#403/#404/#405) — mig **220** (nuvem ✓ 31/08).
- **blindagem** migration-lag (#407): instalar não cai 500 se a migration cloud-only ainda não subiu.

## Estado anterior do edge

- **`1.23.0` — cortada (~30/08):** restore FK-órfão acumulado (restauração de instalação nova conclui).
- **`1.22.0` — cortada (~30/08):** fecha o `fetch failed` (IPv4-first + retry + causa real; `reset-restore.ps1`).
- **`1.21.0` — cortada (29/08):** web.tar+next (RegemEdgeWeb sobe) + pull keyset/don't-abort; **sync ainda batia fetch failed** (corrigido no 1.22 — era IPv6 que o serviço não roteia + socket keep-alive morto).
- **`1.20.0` — QUEIMADA:** build 158 commits atrás + web como pasta (MAX_PATH). Fechada pela disciplina `build-release.ps1` + `preflight-release.mjs`.

## Histórico

| Versão | Data | Tipo | Notas |
|---|---|---|---|
| 1.28.0 | 01/09/2026 | .exe ✅ + .zip (a publicar) | **rebase de seq** (para o flood de "REGRESSÃO" na reinstalação) + **time-box no push** (20s/ciclo → o pull roda e o pedido novo desce) (#414); nuvem (seq) por autodeploy |
| 1.27.0 | 01/09/2026 | .exe ✅ + .zip (a publicar) | **carga do snapshot em LOTE** (500/bloco → restore em segundos, não 10 min) + **push set-based** na nuvem (mata o 502 do upload) + **UI de restore** (barra/progresso/erro) (#413) |
| 1.26.0 | 01/09/2026 | .exe ✅ + .zip (a publicar) | **restore por SNAPSHOT** (arquivo NDJSON gzip por tenant, carga com FK off) substitui a paginação (#411); F1 nuvem por autodeploy + F2 edge no .exe (88 MB) |
| 1.25.0 | 01/09/2026 | .exe ✅ + .zip (a publicar) | fix restore paginado: baixa-primeiro + sempre completo + log por página (#409) — page-by-page ainda não carregava local → aposentado no 1.26 |
| 1.24.0 | 31/08/2026 | .exe + .zip (a compilar/publicar) | F1 saúde + F2 impressão/unidade + F3 trava anti-clone/instalador 2FA + blindagem migration-lag; superset dos fixes de sync 1.22/1.23 (#397–#407); migs 219+220 na nuvem |
| 1.23.0 | ~30/08/2026 | .exe + .zip | restore FK-órfão acumulado (instalação nova conclui) |
| 1.22.0 | ~30/08/2026 | .exe + .zip | fetch failed: IPv4-first + retry (rede + 5xx GET) + causa real; reset-restore.ps1 (#395, #396) |
| 1.21.0 | 29/08/2026 | .exe + .zip | web.tar+next (RegemEdgeWeb sobe), pull keyset+don't-abort, hardening PG; **sync ainda batia fetch failed** (corrigido no 1.22) |
| 1.20.0 | 29/08/2026 | ❌ queimada | build de árvore defasada; web sem next; transacional travado |
| 1.19.0 | — | baseline | último estado bom no origin/main antes da disciplina de build |
