# Integrações com marketplaces (iFood, Cardápio Web/Open Delivery, Anota AI, 99Food)

> Documento de pesquisa + plano. Objetivo: receber pedidos das plataformas
> direto no fluxo do Regem (KDS/produção), **sem mudar a lógica de front nem o
> backend já feito**. Fontes no rodapé.

## 0. TL;DR — por que encaixa sem reescrever nada

As 4 plataformas seguem **o mesmo padrão** ("marketplace → sistema de gestão"):

1. **OAuth2 `client_credentials`** → pega um `access_token` (cache até expirar).
2. **Recebe pedidos** por **polling** (`GET /events` a cada ~30s → `200` com
   eventos ou `204` vazio) **+ acknowledgment** de cada evento, ou por **webhook**.
3. **Ciclo do pedido**: `confirmar/aceitar → despachar → concluir/cancelar`
   (o gestor devolve o status pra plataforma).
4. **Catálogo** (opcional): publica/atualiza o cardápio com o **código do PDV
   (SKU)** pra o pedido chegar com o item certo.
5. **Vínculo de loja** (merchant/store) entre a plataforma e a nossa unidade.

O Regem **já tem as peças**:

| Peça necessária | O que já existe no Regem |
|---|---|
| Guardar credenciais por plataforma | Tabela `integracao` (canal, merchantId, clientId, clientSecret, token, config) + UI em **Delivery · Config · Integrações** |
| Porta de entrada de pedido externo | `POST /delivery/ingest` (guard de token de serviço) → `DeliveryService.ingest(tenantId, unidadeId, canal, raw)` |
| Normalização por plataforma | `adaptar(canal, raw)` em `delivery/adapters.ts` (adaptador por canal) |
| Pedido → produção/KDS | `pedido_externo` + `aceitar()` cria comanda + produção (fluxo atual, intocado) |
| Devolver status | `avancar()` / `cancelar()` já disparam webhooks; ganham 1 chamada extra à API da plataforma |

**Portanto, integrar = escrever, por plataforma:** (a) um **poller/receiver**
(OAuth + polling/webhook), (b) um **adaptador** de JSON, (c) um **sync de status**
de volta, e (d, opcional) **push de catálogo**. **Nada muda** no `pedido_externo`,
no KDS, nem no front.

---

## 1. Onde roda o "poller" (decisão de arquitetura)

Dois caminhos (não excludentes):

- **Nuvem (recomendado para começar):** um serviço agendado (cron/`@nestjs/schedule`)
  no `regem-api` faz o OAuth + polling de cada loja integrada e chama o
  `ingest` internamente. Simples de operar, sem depender de máquina na loja.
  Funciona com o modelo "aplicação centralizada" do iFood (1 token acessa várias
  lojas; acima de 500 lojas usa header/lotes ou webhook).
- **Edge (loja):** o worker local (ver `[[arquitetura-edge]]`) faz o polling e
  `POST /delivery/ingest`. Combina com o que já está desenhado, mas exige o box
  na loja. Bom para impressão térmica local; opcional para os pedidos.

> Recomendação: **poller na nuvem** para os marketplaces (menos fricção);
> mantém o edge só para impressão/KDS local.

---

## 2. Padrão de implementação no Regem (vale para todas)

Para cada plataforma nova, criamos um módulo `integracoes/<plataforma>/`:

1. **Auth**: `token()` — POST no `/oauth/token` com `clientId/clientSecret`
   (lidos da tabela `integracao`), cacheia o `access_token`.
2. **Poller**: cron a cada 30s → `GET /events` → para cada evento de pedido novo,
   busca os detalhes (`GET /orders/{id}`) → `adaptar(canal, raw)` → `ingest(...)`
   → **`acknowledgment`** dos eventos.
3. **Adapter**: `adaptar<Plataforma>(raw)` → `PedidoNormalizado` (já existe a
   interface; o do iFood já está esboçado em `adapters.ts`).
4. **Status back**: no `avancar()`/`cancelar()` do delivery, se o pedido veio da
   plataforma, chamar `POST /orders/{id}/confirm|dispatch|cancel`.
5. **Catálogo (opcional)**: `publicarCatalogo()` — mapeia produtos do Regem
   (com `codigo`/SKU) para o formato da plataforma.

Config das credenciais: **já dá para usar a UI de Integrações** (canal por
plataforma). Só ampliar os campos por canal se precisar (ex.: `clientId`,
`clientSecret`, `merchantId`).

---

## 3. Plataforma a plataforma

### 3.1 Open Delivery — cobre **Cardápio Web** (e outros que adotam o padrão) ⭐

**O que é:** padrão **aberto e gratuito da Abrasel** (spec v1.7+, open source)
que padroniza catálogo, pedidos, logística e conciliação entre restaurantes,
sistemas de gestão e marketplaces. **Uma implementação → vários marketplaces**
que falam Open Delivery. O **Cardápio Web** expõe Open Delivery em
**Configurações → Integrações → API Open Delivery**.

**Modelo técnico (idêntico ao nosso desenho):**
- Auth: `POST /oauth/token` (client_credentials) com `clientId`/`clientSecret`
  fornecidos pela "Ordering Application" (o marketplace).
- Pedidos: **polling** no endpoint de eventos (`200` com eventos / `204` vazio)
  **+ acknowledgment** obrigatório de cada evento (senão repete).
- Ciclo: order confirm/dispatch/cancel; Merchant (status da loja) e Catalog.

**Passo a passo:**
1. No Cardápio Web da loja: Configurações → Integrações → **API Open Delivery**
   → gerar/obter `clientId`, `clientSecret` e as URLs base.
2. Cadastrar essas credenciais na Integração `open_delivery` (tabela `integracao`).
3. Implementar `token()` + poller + `adaptarOpenDelivery()` + status back.
4. Vincular a loja (merchant) e testar com pedidos de teste.
5. Publicar catálogo com `externalCode` = nosso `produto.codigo` (SKU) para
   casar o item.

**Esforço:** médio. **Alavancagem: altíssima** (spec pública, sem homologação
pesada por plataforma, reutilizável). **Cobre o Cardápio Web já de cara.**

### 3.2 iFood — Merchant API (maior valor, maior complexidade)

**Modelo técnico:**
- Portal do desenvolvedor (`developer.ifood.com.br`): cadastro cria **loja e app
  de teste** automaticamente. Escolhe negócio (Food/Grocery).
- Auth: `client_credentials` → `access_token` (expira em ~6h; cachear).
- Pedidos: **polling `GET /events:polling` a cada 30s** (`200`/`204`) +
  **`/acknowledgment`** (até 2000 IDs por request). *A loja fica "online"
  enquanto o polling roda; se parar, sai do ar.* Acima de 500 lojas: header
  `x-polling-merchants` em lotes ou **webhook** (tempo real).
- Módulos: **Order** (pedidos), **Merchant** (status/loja), **Catalog**
  (produtos), Events, Shipping.
- **Homologação obrigatória**: desenvolve com o app de teste → solicita agenda
  pelo portal (aba Suporte) → iFood valida os fluxos na loja de teste (~1 semana
  + ~10–15% de ajustes) → aprova → cria app de produção → habilita nas lojas.

**Passo a passo:**
1. Criar conta no Portal do Desenvolvedor iFood; anotar `clientId/clientSecret`
   do app de teste.
2. Implementar auth + **polling + acknowledgment** + `adaptarIfood()` (já
   esboçado) → `ingest`.
3. Implementar **status back** (confirm/ready-to-pickup/dispatch/cancel) ligado
   ao nosso kanban.
4. (Opcional) Catalog: publicar cardápio com `externalCode` = SKU.
5. Passar pelos **critérios de homologação** do módulo Order e agendar validação.
6. Migrar para app de produção e habilitar nas lojas reais.

**Esforço:** alto (homologação). **Valor:** o maior do mercado.

### 3.3 99Food (extra) — developer portal 99app

**Modelo técnico:**
- Portal: `developer-food.99app.com`. O integrador cria um **link de integração**
  no portal de gestão da API e envia ao lojista; o lojista **autoriza**; o
  integrador **vincula a loja** e gera o **`AppShopID`**.
- Pedidos chegam via API para o sistema de gestão (mesmo padrão de eventos +
  reconhecimento de itens por código de PDV).

**Passo a passo:**
1. Cadastro no developer portal 99Food; obter credenciais de integrador.
2. Gerar link de autorização → lojista autoriza → vincular loja (`AppShopID`).
3. Implementar auth + recebimento de pedidos + `adaptar99Food()` → `ingest`.
4. Casar produtos por código de PDV; status back.

**Esforço:** médio. **Prioridade:** extra (mercado ainda em expansão no BR).

### 3.4 Anota AI — programa de parceiros (comercial + técnico)

**Modelo técnico (o mais "fechado" dos quatro):**
- Integração é via **programa de parceiros**: a revenda/integrador abre um
  **ticket no suporte** com o **token do estabelecimento**; o suporte gera os
  tokens de vínculo. Há uma seção **"Integrações"** no painel para parceiros
  comerciais. Vários PDVs integram assim (MarketUp, Uniplus, Consumer, Machine,
  cplug). Parte do ecossistema também fala **Open Delivery** (ex.: fluxos
  "Cardápio Web/Anota via Open Delivery"), então **pode ser que a 3.1 já cubra**.

**Passo a passo:**
1. **Virar parceiro** Anota AI (trilha comercial) e obter acesso à API de
   parceiros / confirmar se expõem **Open Delivery**.
2. Se Open Delivery: reusar a implementação da 3.1. Se API própria: abrir ticket
   com o token do estabelecimento → receber tokens → implementar
   `adaptarAnota()` → `ingest` + status back.

**Esforço:** técnico médio, mas **depende de aprovação de parceria** (gate
comercial, não só código).

---

## 4. Ordem sugerida (do mais fácil/alavancado ao mais complexo)

| Fase | Entrega | Por quê |
|---|---|---|
| **0. Base genérica** | Módulo `integracoes/` com: interface de adapter (já existe), serviço de OAuth+cache, poller agendado, `status back` plugado no kanban, e telemetria/erros. | Fundação reutilizável; **não muda front nem `pedido_externo`**. |
| **1. Open Delivery** (Cardápio Web) | Auth + polling + `adaptarOpenDelivery` + status + catálogo. | Spec **aberta**, testável sem homologação pesada, **1 impl → N marketplaces**. Já entrega o **Cardápio Web** (prioridade). |
| **2. iFood** | Auth + polling/ack + `adaptarIfood` + status + catálogo + **homologação**. | Maior valor; a base da Fase 0 acelera. |
| **3. Anota AI** | Parceria + (Open Delivery **ou** API de parceiros) + adapter. | Depende do gate comercial; pode reusar a Fase 1. |
| **4. 99Food** (extra) | Portal 99app + autorização + adapter. | Complementar. |

> Racional: a **Fase 0 + Fase 1** dão o maior retorno com o menor risco (padrão
> aberto, reutilizável, cobre Cardápio Web). iFood vem forte na sequência.

---

## 5. Checklist do que construir no Regem (sem tocar no front/lógica atual)

- [ ] **Fase 0** — `backend/src/modules/integracoes/`:
  - [ ] `oauth.service.ts` (client_credentials + cache de token por integração).
  - [ ] `poller.service.ts` (`@nestjs/schedule` a cada 30s; itera integrações
        ativas; chama o adapter de cada canal; faz `ingest` + acknowledgment).
  - [ ] Hook de **status back** em `DeliveryService.avancar/cancelar` (se o
        pedido tem `canal`+`externalId`, chama a API da plataforma).
  - [ ] Migration só se precisar de campos extras em `integracao` (hoje já tem
        merchantId/clientId/clientSecret/token/config — provavelmente suficiente).
- [ ] **Fase 1** — `integracoes/open-delivery/` (adapter + endpoints).
- [ ] **Fase 2** — `integracoes/ifood/` (+ processo de homologação).
- [ ] **Fase 3/4** — `integracoes/anota/`, `integracoes/99food/`.
- [ ] Catálogo: reusar `produto.codigo` (SKU) como `externalCode` em todas.
- [ ] UI: a tela **Delivery · Config · Integrações** já existe; só acrescentar
      os canais e os campos de credencial que faltarem.

**Garantias:** o ponto de entrada continua sendo `ingest → adaptar → pedido_externo
→ KDS`. O front do cardápio, o checkout, o kanban e o KDS **não mudam**.

---

## Fontes
- iFood Developer — visão geral, módulos, homologação: https://developer.ifood.com.br/pt-BR/docs/getting-started · https://developer.ifood.com.br/pt-BR/docs/guides/modules/order/homologation/ · https://developermercado.ifood.com.br/docs/partners/
- iFood — polling de eventos / acknowledgment / auth centralizada: https://developer.ifood.com.br/en-US/docs/guides/modules/events/polling-overview/ · https://developer.ifood.com.br/en-US/docs/guides/modules/authentication/centralized/
- Open Delivery (Abrasel) — sobre e spec: https://www.opendelivery.com.br/sobre/ · https://abrasel-nacional.github.io/opendelivery/
- Cardápio Web — Open Delivery: https://ajuda.cardapioweb.com/automacao/integracoes/open-delivery · https://suporte.machine.global/hc/pt-br/articles/31608831558427
- Delivery Direto — Open Delivery API (referência de implementação): https://developers.deliverydireto.com.br/open-delivery-api/docs/
- Anota AI — integrações/parceiros: https://anota.ai/home/integracoes/ · https://suporte.machine.global/hc/pt-br/articles/21967534666011
- 99Food — developer portal e integração: https://developer-food.99app.com/ · https://rcky.com.br/blog/99food-integracao/
