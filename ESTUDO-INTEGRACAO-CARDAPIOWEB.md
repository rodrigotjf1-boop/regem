# Estudo — Integração Regem ⇄ Cardápio Web (puxar pedidos)

> **Fase de estudo + plano. Nada codado ainda.** Objetivo desta fase: o Regem **puxar os pedidos** feitos no Cardápio Web (produto externo) e transformá-los em comanda + produção no KDS, como já faz com iFood/Open Delivery. Fonte do lado Regem: inspeção do código (20/07/2026). Fonte do lado Cardápio Web: documentação oficial `docs.cardapioweb.com` (API Aberta).

---

## 1. O que o Regem já tem (não precisa construir)

O Regem **já é feito para puxar pedido de canal externo** — isto roda em produção para iFood/Open Delivery:

- **Pipeline de ingestão:** `delivery.service.ingest(tenant, unidade, canal, pedidoBruto)` (`backend/src/modules/delivery/delivery.service.ts:80`) → adapta → idempotência (`clientRef` / `(tenant,canal,externalId)`) → grava `pedido_externo` status `novo` → materializa comanda + produção (`vendas.venderExterno`), baixa estoque, credita cashback.
- **Adapters por canal:** `backend/src/modules/delivery/adapters.ts` (iFood, Open Delivery, genérico). **Basta adicionar `adaptarCardapioWeb`.**
- **Tabela `pedido_externo`** (`schema.ts:1830`): canal, externalId, displayId, itens jsonb, cliente, endereço, pagamento, status + timestamps, sync bidirecional.
- **Ciclo de vida:** `novo→confirmado→pronto→despachado→concluido` + `cancelado` (`delivery.service.ts:37`).
- **Materialização adiada p/ edge** (heartbeat < 3 min) + fallback nuvem (`cloud-fallback.processor.ts`) — funciona com ou sem servidor local na loja.
- **OAuth de parceiro (parcial):** já existe um cliente OAuth para Open Delivery (`open-delivery.service.ts`), mas usa `client_credentials` — **não serve direto** para o Cardápio Web (ver §3).

**Conclusão:** o "miolo" (ingestão → KDS) está pronto. O que falta é o **conector do Cardápio Web** na frente dele.

---

## 2. O que o Cardápio Web oferece (pesquisa da documentação)

O Cardápio Web tem **dois caminhos** de integração:

### Rota A — API Aberta nativa (docs.cardapioweb.com) ← documentação completa em mãos
- **Auth: OAuth 2.0 `authorization_code` + PKCE, modelo "CW App Store"** (⚠️ **não** é `client_credentials`).
  - O app "Regem" é **publicado/aprovado** na CW App Store (Sandbox e depois Produção).
  - A **loja instala** o app e **autoriza por consentimento** (portal CW, PKCE): `client_id`, `state`, `redirect_uri`, `code_challenge` → callback com `code` → troca por token.
  - **Token endpoint:** `POST https://integracao.cardapioweb.com/api/partner/oauth/token` (sandbox: `integracao.sandbox.cardapioweb.com`), `application/x-www-form-urlencoded`.
  - Retorna `access_token` (Bearer, **expira em 2h / 7200s**) + `refresh_token`. Renova com `grant_type=refresh_token`.
  - **Cada instalação gera credenciais próprias, vinculadas a (app + loja)** → token acessa só aquela loja. Multi-tenant natural.
  - **Escopos:** `store`, `catalog`, `orders`.
- **Receber pedidos — dois mecanismos:**
  - **Webhook (recomendado pelo CW):** URL registrada no cadastro do app (criada automaticamente quando a loja instala). `POST application/json` com **`{ order_id, event_id }`** (NÃO manda o pedido inteiro). Header **`X-Webhook-Token`** para validar. Responder **200 em até 5s**. Idempotência por `event_id`. Retry 15× backoff exponencial. Eventos: criação de pedido + mudança de status.
  - **Polling (alternativa):** `GET https://integracao.cardapioweb.com/api/partner/v1/orders?updated_since=...&status[]=...` → array de `LiteOrder` (`id,status,order_type,created_at,updated_at`). Rate limit **300 req / 3 min**. Recomendado 30s. **Sem acknowledge.**
- **Detalhe do pedido:** `GET /api/partner/v1/orders/{order_id}` → objeto `Order` completo (schema no §4).
- **Status de volta (Regem → CW):** `aceitar-pedido`, `iniciar-preparacao`, `pedido-pronto`, `pedido-entregue`, `finalizar-pedido`, `cancelar-pedido`.
- **Catálogo e Loja:** módulos `catalog` (categorias/itens/complementos/opções/imagens) e `store` (loja, clientes, cupons, métodos de pagamento) — úteis numa fase futura (empurrar menu / de-para de itens).

### Rota B — Open Delivery (Abrasel)
- A loja habilita **API Open Delivery** no Cardápio Web (Configurações → Integrações), gera **Establishment ID + Establishment Secret**, e registra um **webhook** (ex.: o PDV Machine registra `.../opendelivery/v1/newEvent`).
- Padrão **Abrasel** — reutilizável para qualquer marketplace que o implemente. O Regem já tem um consumidor Open Delivery parcial, mas construído para **polling + client_credentials**; a versão do CW é **webhook**, então também exigiria um receiver novo.

---

## 3. Rota recomendada

**Recomendo a Rota A (API Aberta nativa) com WEBHOOK como mecanismo.** Por quê:

| Critério | Rota A (nativa) | Rota B (Open Delivery) |
|---|---|---|
| Documentação em mãos | ✅ Completa e concreta | ⚠️ Fragmentária (só ajuda/terceiros) |
| Riqueza do pedido | ✅ Cliente, endereço, itens+opções, pagamentos, agendamento | Schema Abrasel genérico |
| Suporte / longevidade | ✅ API first-class, ativa | Caminho secundário no CW |
| Tempo real | ✅ Webhook (instantâneo) | Webhook |
| Reaproveita código Regem | Parcial (adapter novo + OAuth novo) | Parcial (OD service existe, mas é polling) |
| Reusável p/ outros marketplaces | ❌ Só CW | ✅ Padrão aberto |

**Webhook > polling** porque a nuvem do Regem (`api.dmsregem.com`) é publicamente alcançável, dá tempo real (vs 30s), e o CW recomenda. Mantemos o polling como **fallback/reconciliação** (rede de segurança se um webhook falhar), reusando o padrão dos processors `@Interval` que já existem.

> Se a meta de médio prazo for integrar **vários** cardápios/marketplaces, a Rota B (Open Delivery) vira mais estratégica (um conector, N marketplaces). Para **este** caso (Cardápio Web, com docs completas e dados ricos), a Rota A entrega mais rápido e melhor.

---

## 4. Mapa do pedido: `Order` (CW) → `pedido_externo` (Regem)

Schema real do CW (exemplo da doc) e o de-para para o adapter `adaptarCardapioWeb`:

| Campo CW | Campo Regem (`pedido_externo` / itens) | Observação |
|---|---|---|
| `id` | `externalId` | idempotência por `(tenant, 'cardapio_web', externalId)` |
| `display_id` | `displayId` / `numero` | número amigável |
| `status` | `status` | de-para: `waiting_confirmation→novo`, `confirmed/scheduled_confirmed→confirmado`, `ready→pronto`, `released/waiting_to_catch→despachado`, `delivered/closed→concluido`, `canceled→cancelado` |
| `order_type` | `tipo` | `delivery→entrega`, `takeout→retirada`, `onsite/closed_table→mesa/local` |
| `order_timing` + `schedule` | `agendamento` | `scheduled` → guarda janela `scheduled_date_time_start/end` |
| `sales_channel` | `raw.salesChannel` | catalog/portal/ifood/whatsapp_extension (informativo) |
| `customer{name,phone,ddi}` | `clienteNome`, `clienteTelefone` | |
| `delivery_address{street,number,neighborhood,complement,reference,city,state,lat,lng}` | `enderecoRua`, `enderecoNumero`, `enderecoBairro`, `enderecoReferencia`, `endereco`, lat/lng | |
| `items[]{item_id,name,quantity,unit_price,total_price,observation,options[]}` | `itens` (jsonb) | **de-para de item (§5)** |
| `items[].options[]{option_id,name,quantity,unit_price,option_group_*}` | complementos do item | idem |
| `delivery_fee` | `taxaEntrega` | |
| `discounts[]` | `desconto` | somatório |
| `payments[]{payment_method,payment_type,status,change_for}` | `formaPagamento`, `pago`, `statusPagamento`, `trocoPara` | `payment_type offline→na_entrega`; `online + status paid→pago` |
| `total` | `total` | |
| `created_at` / `updated_at` | timestamps | |

**Valores em reais decimais** no CW (`12.9`) → o Regem trabalha em **centavos** internamente; o adapter converte.

---

## 5. O que falta construir (lacunas)

1. **App na CW App Store** (Sandbox → Produção): registrar o "Regem", definir `redirect_uri` de callback e `webhook_url`, obter `client_id`, pedir escopos `orders` (+ `store`; `catalog` para o futuro). *Ação no painel do Cardápio Web, feita pelo usuário/nós.*
2. **Fluxo OAuth authorization_code + PKCE** no Regem: iniciador do consentimento (botão "Conectar Cardápio Web") + **callback** que troca `code`→tokens e **persiste por loja** (tabela `integracao`, canal `cardapio_web`).
3. **Refresh de token** (expira em 2h): renovar antes de vencer (job `@Cron` no `JobsService` e/ou refresh reativo no 401).
4. **Webhook receiver:** `POST /api/v1/integracoes/cardapio-web/webhook` (público, valida `X-Webhook-Token`, idempotência por `event_id`, responde 200 rápido; async: `GET /orders/{order_id}` com o Bearer da loja → adapter → `delivery.ingest`).
5. **Adapter `adaptarCardapioWeb`** em `adapters.ts` (o de-para do §4).
6. **De-para de item** (`item_id` do CW → `produto` do Regem): o ponto sensível. Opções — (a) casar por **código/SKU** se os itens do CW carregarem o mesmo código dos produtos do Regem (o `ingest` já mapeia "por código"); (b) tabela de-para manual; (c) no futuro, empurrar o catálogo do Regem → CW (módulo `catalog`) para os ids nascerem alinhados. **Decisão necessária.**
7. **Aceite de volta (recomendado, mínimo):** ao ingerir, chamar `aceitar-pedido` no CW — senão o pedido fica "waiting_confirmation" lá e o cliente não é notificado. Tecnicamente é "status de volta", mas o **aceite** é o mínimo para a integração ser funcional. **Confirmar se entra já.**
8. **Poller de reconciliação (fallback):** `@Interval` que a cada X puxa `GET /orders?updated_since=` e ingere o que o webhook tiver perdido (idempotente).
9. **UI de conexão + módulo ativável:** tela para a loja conectar/desconectar o Cardápio Web (status do token) e, opcionalmente, `monitor_visao`-style, um módulo `cardapio_web` ativável.

---

## 6. Plano por fases (proposta — aprovar antes de codar)

- **F0 — App + Sandbox:** registrar o app "Regem" na CW App Store (Sandbox), obter `client_id`, apontar `redirect_uri`/`webhook_url` para a nuvem. *(painel CW)*
- **F1 — OAuth + conexão:** tabela/uso de `integracao` canal `cardapio_web`; iniciador do consentimento + callback (authorization_code+PKCE) + persistência do token por loja + refresh. Tela "Conectar Cardápio Web".
- **F2 — Ingestão:** adapter `adaptarCardapioWeb` + de-para de item + webhook receiver → `delivery.ingest`. Aceite de volta (mínimo). Teste com a loja de teste (Sandbox).
- **F3 — Robustez:** poller de reconciliação (fallback), tratamento de status/cancelamento vindos do CW, idempotência ponta a ponta, telemetria de erro.
- **F4 (futuro, fora deste escopo):** empurrar catálogo Regem→CW (alinhar itens) e status de preparo de volta (pronto/saiu/entregue).

**Migrations:** provavelmente **nenhuma nova** — `integracao` e `pedido_externo` já comportam (canal `cardapio_web`, token/credenciais em `integracao.config`). Confirmar na F1.

---

## 7. Decisões necessárias antes de codar

1. **Ambiente:** começar em **Sandbox** (`integracao.sandbox.cardapioweb.com`) e depois promover a Produção? (recomendo sim).
2. **Registro do app na CW App Store:** quem cria/publica o app "Regem" (precisa de conta parceiro no CW). Sem o `client_id` + app aprovado, o OAuth não roda.
3. **De-para de item** (§5.6): casar por código/SKU, tabela manual, ou empurrar catálogo depois? Como os itens da sua loja de teste no CW estão codificados?
4. **Aceite de volta** (§5.7): já incluir o `aceitar-pedido` na F2 (recomendo) ou só ingerir?
5. **Rota A vs B:** confirma a Rota A (nativa) que recomendei, ou quer a Open Delivery (padrão reusável)?

---

## Fontes
- [Fluxo de integração — Cardápio Web](https://docs.cardapioweb.com/fluxo-integracao.md)
- [OAuth — obter token](https://docs.cardapioweb.com/api-reference/autenticacao/oauth/obter-token.md)
- [CW App Store — instalação e autorização](https://docs.cardapioweb.com/cw-app-store/instalacao-e-autorizacao.md)
- [Webhooks — visão geral](https://docs.cardapioweb.com/webhooks/visao-geral.md)
- [Pedidos — polling](https://docs.cardapioweb.com/api-reference/pedidos/polling-de-pedidos.md)
- [Pedidos — consultar detalhes](https://docs.cardapioweb.com/api-reference/pedidos/consultar-detalhes-do-pedido.md)
- [Índice completo (llms.txt)](https://docs.cardapioweb.com/llms.txt)
