# iFood — Catalog API v2 (estudo para o app de controle de catálogo)

> **Escopo:** entender a fundo o módulo **Catalog** do iFood para construir um
> **app separado de controle de catálogo**. Este documento **não altera** a
> integração de pedidos já homologada (`backend/src/modules/integracoes/ifood/`) —
> aquela usa só os módulos **Order + Events + Merchant** e continua intocada.
>
> **Proveniência:** o portal `developer.ifood.com.br` está atrás de Cloudflare e
> bloqueia fetch automatizado. O conteúdo abaixo foi consolidado de espelhos
> públicos da doc oficial + coleção Postman oficial do Catalog v2 (40 endpoints),
> cruzado com o payload real da nossa loja de teste. Itens marcados **(confirmar)**
> precisam de conferência na página viva/logada antes de virar código.

---

## 0. TL;DR

- **Base:** `https://merchant-api.ifood.com.br/catalog/v2.0` · auth = **o mesmo**
  `Bearer accessToken` do OAuth `client_credentials` que já usamos.
- **O módulo Catalog já está habilitado no nosso app** (portal → Meus aplicativos
  → módulos: Order, Catalog, Financial, Review, Logistics, Shipping, Item,
  Picking, Events, Merchant, + Groceries/Promotion legados). No app de **teste**
  vêm todos marcados e não editáveis.
- **v2 é a versão atual**; v1 é legado (deadline de migração 30/05/2025 já passou).
- **40 endpoints** em 9 famílias: catálogos, categorias, itens, produtos,
  inventário, grupos de complementos, opções, versão, imagens.
- **Não existe evento/webhook de catálogo.** O módulo Events só emite eventos de
  **pedido**. Consequência de arquitetura: se o lojista editar pelo iFood Gestor,
  só descobrimos **relendo** (pull). Todo desenho de sync tem que assumir isso.
- **Dinheiro em reais decimais** (`12.9`), não em centavos — converter na borda.
- **`externalCode` é a chave PDV ↔ iFood** e o que permite upsert idempotente.

---

## 1. Modelo de entidades

```
Catálogo (catalogId)                       ← 1 por merchant, com contexto(s)
└── Contexto (DEFAULT = Entrega, INDOOR = Cardápio Digital/salão, …)
    └── Categoria (template DEFAULT | PIZZA)
        └── Item  ← a OFERTA: produto + categoria + preço/status (por contexto)
            ├── Produto (nome, descrição, imagem, EAN, restrições alimentares)
            └── Grupo de complementos (optionGroup, min/max)
                └── Opção (complemento — também é um Produto, com preço próprio)
```

| Entidade | O que é |
|---|---|
| **Catálogo** | Raiz. Um merchant pode ter mais de um; cada um serve um ou mais **contextos**. `GET /catalogs` é **sempre o primeiro passo**. |
| **Categoria** | Agrupador ("Lanches", "Bebidas"). `template` = `DEFAULT` ou `PIZZA` (no máx. **uma** categoria PIZZA por loja). |
| **Produto** | Informação geral: nome, descrição, imagem, EAN, turnos, restrições alimentares, `externalCode`. **Criar produto não coloca à venda.** |
| **Item** | A **oferta** do produto: produto + categoria + `price` + `status`, com variação por contexto. É o que o cliente vê. |
| **Grupo de complementos** | Agrupa customizações do produto ("Escolha sua bebida"), com `min`/`max` e `optionGroupType`. |
| **Opção / complemento** | A escolha dentro do grupo. Também aponta para um `productId` e tem preço/`externalCode` próprios. |

**Tipos de item:** `DEFAULT`, `PIZZA` e `COMBO_V2` (novo, em disponibilização —
até lá o padrão de mercado é combo = item `DEFAULT` com grupos obrigatórios
`min=max=1` por escolha). **(confirmar shape do COMBO_V2)**

**Tipos de grupo (`optionGroupType`):** `OFFER_UNIT` (cross-sell),
`SPECIFICATION` (ponto da carne), `INGREDIENTS` (com/sem cebola — relevante para
alergias), `CUTLERY` (talheres), e os exclusivos de pizza `SIZE`, `CRUST`,
`EDGE`, `TOPPING`.

---

## 2. Contextos e `catalogContext` — a regra de ouro

O v2 unificou catálogos: **as mesmas categorias/itens servem vários canais**, com
**preço e status diferentes por contexto** (o antigo módulo Multisetup foi
absorvido em 30/04/2024).

| Contexto | Canal |
|---|---|
| `DEFAULT` | Entrega (o app do iFood) |
| `INDOOR` | Consumo no local / mesa |
| `WHITELABEL` | Cardápio Digital |

Duas formas de variar por contexto:

1. **`contextModifiers[]`** dentro do item/opção — `{ catalogContext, price, status, externalCode }`.
2. **Parâmetro `catalogContext`** (query ou `*ByCatalog[]` no body) nos endpoints pontuais.

> ⚠️ **`catalogContext` omitido = a operação vale para TODOS os contextos.**
> Esse é o erro clássico: sem informar o contexto, um repricing de delivery
> também muda o preço do salão/cardápio digital. E **contexto não listado em
> `contextModifiers` herda o valor da raiz** do item.

---

## 3. Os 40 endpoints

Base: `https://merchant-api.ifood.com.br/catalog/v2.0`

### 3.1 Catálogos
| # | Método | Path | Nota |
|---|---|---|---|
| 1 | GET | `/merchants/{merchantId}/catalogs` | Primeiro passo. Retorna `catalogId`, `context[]`, `status`, `modifiedAt`, `groupId`. |
| 2 | GET | `/merchants/{merchantId}/catalogs/{catalogId}/unsellableItems` | **Diagnóstico**: o que está invendável e por quê (`restrictions[]`), inclusive pizza (sabores/massas/bordas/tamanhos). |
| 3 | GET | `/merchants/{merchantId}/catalogs/{groupId}/sellableItems` | Visão "como o cliente vê" (achatada). ⚠️ usa **`groupId`**, não `catalogId`. |

### 3.2 Categorias
| # | Método | Path | Nota |
|---|---|---|---|
| 4 | GET | `/merchants/{merchantId}/catalogs/{catalogId}/categories` | `?includeItems=true` traz itens + grupos. **É o "dump" do cardápio.** |
| 5 | POST | `.../categories` | Cria. `409` se nome/id duplicado. |
| 6 | GET | `.../categories/{categoryId}` | Idem, uma categoria. |
| 7 | PATCH | `.../categories/{categoryId}` | Parcial (`name`, `externalCode`, `status`, `index`). Status **propaga aos itens**. |
| 8 | DELETE | `/merchants/{merchantId}/categories/{categoryId}` | ☠️ Apaga a categoria **e todos os itens dentro**, em todos os serviços. |
| 9 | GET | `/merchants/{merchantId}/categories/{categoryId}/items` | Formato **normalizado** (`items[]`, `products[]`, `optionGroups[]`, `options[]`). |

### 3.3 Itens (a oferta)
| # | Método | Path | Nota |
|---|---|---|---|
| 10 | PUT | `/merchants/{merchantId}/items` | ⭐ **O endpoint principal.** Cria/atualiza item + produto + grupos + opções num payload só. ⚠️ **Ignora o `item.id` enviado** e gera o seu — mas **preserva o `externalCode`** (ver §4.8). |
| 11 | GET | `/merchants/{merchantId}/items/{itemId}/flat` | Mesmo shape do PUT — ideal para diff antes de escrever. |
| 12 | PATCH | `/merchants/{merchantId}/items/price` | Repricing leve; aceita `priceByCatalog[]`. |
| 13 | PATCH | `/merchants/{merchantId}/items/status` | **Pausa rápida ("86")**; aceita `statusByCatalog[]`. |
| 14 | PATCH | `/merchants/{merchantId}/items/externalCode` | Troca o código PDV (global ou por contexto). |
| 15 | DELETE | `/merchants/{merchantId}/categories/{categoryId}/products/{productId}` | Remove só a **associação** produto↔categoria (não apaga o produto). |

### 3.4 Produtos
| # | Método | Path | Nota |
|---|---|---|---|
| 16 | GET | `/merchants/{merchantId}/products` | Paginado — `limit` (**máx. 200**) + `page`, ambos obrigatórios. |
| 17 | POST | `/merchants/{merchantId}/products` | Cria (ainda **não** está à venda). |
| 18 | PUT | `/merchants/{merchantId}/products/{productId}` | Edita — **propaga para todos os itens e opções** que usam o produto. |
| 19 | DELETE | `/merchants/{merchantId}/products/{productId}` | ☠️ Apaga o produto **e todos os itens/opções**, em todos os catálogos. Maior raio destrutivo da API. |
| 20 | PATCH | `/merchants/{merchantId}/products/status` | **Lote assíncrono** por `productId` ou `externalCode` → `batchId`. `resources[]` limita a `ITEM`/`OPTION`. |
| 21 | PATCH | `/merchants/{merchantId}/products/price` | Lote assíncrono de preço → `202` com `url` + `batchId`. |
| 22 | GET | `/merchants/{merchantId}/products/externalCode/{externalCode}` | Busca pelo código PDV — **a ponte com o nosso catálogo**. |
| 23 | GET | `/merchants/{merchantId}/product/{productId}` | ⚠️ path no **singular**. |
| 24 | GET | `/merchants/{merchantId}/batch/{batchId}` | Resultado do lote: `results[].resourceId/result/failureReason`. |

### 3.5 Inventário (estoque)
| # | Método | Path | Nota |
|---|---|---|---|
| 25 | POST | `/merchants/{merchantId}/inventory` | `{productId, amount}` — ao zerar, sai de venda. |
| 26 | GET | `/merchants/{merchantId}/inventory/{productId}` | Consulta. |
| 27 | POST | `/merchants/{merchantId}/inventory/batchDelete` | Remove o controle de quantidade de uma lista. |

### 3.6 Grupos de complementos
| # | Método | Path | Nota |
|---|---|---|---|
| 28 | GET | `/merchants/{merchantId}/optionGroups` | `?includeOptions=true`. |
| 29 | PATCH | `.../optionGroups/{optionGroupId}` | Atualiza **só o nome**. |
| 30 | PATCH | `.../optionGroups/{optionGroupId}/status` | ⚠️ Afeta **todos os produtos** que usam o grupo. |
| 31 | DELETE | `.../optionGroups/{optionGroupId}` | Apaga o grupo. |
| 32 | DELETE | `.../optionGroups/{id}/products/{productId}` | Desassocia grupo ↔ produto. |
| 33 | DELETE | `.../optionGroups/{id}/products/{productId}/option` | Remove uma opção do grupo. |

### 3.7 Opções (complemento individual)
| # | Método | Path | Nota |
|---|---|---|---|
| 34 | PATCH | `/merchants/{merchantId}/options/price` | Com `priceByCatalog[]` e `parentCustomizationOptionId`. |
| 35 | PATCH | `/merchants/{merchantId}/options/status` | Pausa de complemento (ex.: acabou o bacon). |
| 36 | PATCH | `/merchants/{merchantId}/options/externalCode` | Código PDV do complemento. |

### 3.8 Versão do catálogo
| # | Método | Path | Nota |
|---|---|---|---|
| 37 | GET | `/merchants/{merchantId}/catalog/version` | v1 ou v2. **Checar antes de tudo.** |
| 38 | POST | `/merchants/{merchantId}/version/upgrade` | ☠️ `?cleanMigration=true` **apaga todas as entidades** do catálogo. |
| 39 | POST | `/merchants/{merchantId}/version/downgrade` | Volta para v1 (perde endpoints v2). |

### 3.9 Imagens
| # | Método | Path | Nota |
|---|---|---|---|
| 40 | POST | `/merchants/{merchantId}/image/upload` | Retorna o path que alimenta `imagePath`/`image`/`multipleImages`. Schema do body **(confirmar — provável base64)**. |

---

## 4. Regras invioláveis e red flags de homologação

1. **POST cria, PUT atualiza.** Usar POST para atualizar item "degrada a
   performance da integração" e é **red flag explícita na homologação**.
2. **Alteração pontual usa o PATCH dedicado**, não o `PUT /items` completo —
   preço, status e externalCode têm caminho leve próprio.
3. **`catalogContext` sempre explícito** quando a mudança for de um canal só.
4. **Retry com backoff exponencial** (1s, 2s, 4s… teto de 10 min) + header
   **`idempotencyKey`** para repetir com segurança. `4xx` nunca se repete.
5. **Precedência de disponibilidade:** `paused` vence turno (`shifts`). Item
   pausado não aparece mesmo dentro do turno configurado.
6. **Homologação do Catalog é separada** da do Order: exige CNPJ, sessão remota
   agendada por ticket, e valida listar catálogos → criar categorias → criar e
   gerenciar itens/opções → PUT para atualizar → preço/disponibilidade refletindo
   no app. Reprovou = **15 dias** para reagendar.
7. **Performance**: a referência de mercado usada em homologação é sincronizar
   **100+ itens em menos de 10 s** — daí os PATCH em lote (`/products/price`,
   `/products/status`) em vez de laço item a item.
8. ⚠️ **`PUT /items` ignora o `item.id` que você envia** e gera um `itemId`
   próprio — mas **preserva o `externalCode`**. Consequência: **a chave de
   reconciliação é o `externalCode`, nunca o id.** Guardar o id devolvido e
   recuperar o vínculo pelo `externalCode` quando o id "morrer". *(Verificado em
   campo por integração de terceiro; confirmar no nosso teste.)*
9. **O iFood normaliza nomes** (title-case: `iFood` vira `Ifood`). Toda
   comparação nome-a-nome no diff tem que ser por **nome normalizado**, senão o
   app acusa divergência em item idêntico.

### Erros
- `400` padrão: `{ code, message, requestId, details: { code, field, message } }`.
- `409` conflito: `+ conflictingResources[]` (ids em conflito) — nome de categoria
  duplicado, id de produto duplicado.
- Tabela oficial de códigos de erro **(confirmar na página viva)**.

### "Por que o item não aparece no app?" — ordem de checagem
`status` pausado → turno (`shifts`) → contexto certo (`catalogContext`) →
categoria habilitada → catálogo habilitado → `GET /unsellableItems` para ver as
`restrictions[]`.

---

## 5. O que isso significa para o app de controle de catálogo

| Fato da API | Consequência de projeto |
|---|---|
| **Sem evento/webhook de catálogo** | Sync só por **pull**. Precisa de um "puxar cardápio" (manual + agendado) e de **detecção de divergência** contra o nosso catálogo. `modifiedAt` do `GET /catalogs` é o sinal mais barato de "mudou algo". |
| Lotes de preço/status são **assíncronos** (`batchId`) | Precisa de fila + tela de acompanhamento do lote (`GET /batch/{id}`), não de um "salvar" síncrono. |
| Preço em **reais decimais** | Nosso canônico é centavos → converter só na borda, com teste de arredondamento. |
| `externalCode` é a chave | O app precisa **garantir** `externalCode` único e estável nos nossos produtos (hoje `produto.codigo`), senão o casamento quebra. |
| DELETEs de produto/categoria têm raio enorme | Nunca expor "excluir" sem confirmação dupla; preferir `UNAVAILABLE`. |
| `version/upgrade?cleanMigration=true` apaga tudo | **Nunca** expor essa flag na UI. |
| Um produto editado propaga para todos os itens/opções | A UI tem que mostrar "este produto é usado em N itens/complementos" antes de salvar. |

### Mapeamento Regem ↔ iFood (do épico Catálogo, migs 113–116)

| Regem | iFood |
|---|---|
| `categoria_produto` | Categoria (`template DEFAULT`) |
| `produto` | **Produto** (nome/descrição/imagem) **+ Item** (preço/status/categoria) |
| `produto.codigo` | `externalCode` (item e produto) |
| `complemento` (etapa) | `optionGroup` (+ `min`/`max` na associação produto↔grupo) |
| `opcao` | `option` (que aponta para um `productId` próprio) |
| `produto_complemento` | associação `products[].optionGroups[]` |
| — (não existe no iFood) | ficha técnica/custo: **o catálogo do iFood não carrega custo**, só preço |

---

## 6. Lacunas a fechar antes de codar

- [ ] Schema real do `POST /image/upload` (base64? multipart?).
- [ ] Shape do `COMBO_V2`.
- [ ] Página "padrões comuns" (`guides/common-patterns`) — não recuperável por busca.
- [ ] Tabela oficial de códigos de erro.
- [ ] Confirmar se a nossa loja de teste está em **v2** (`GET /catalog/version`).
- [ ] Confirmar quais contextos a loja tem (`GET /catalogs` → `context[]`).

---

## 7. Modos de integração (autenticação) e onboarding da loja

Base: `https://merchant-api.ifood.com.br/authentication/v1.0`. O tipo do app é
escolhido **na criação no portal** e não se troca depois. Token dura **6 h**
(`expiresIn: 21600`); os escopos vêm dos módulos marcados e viajam no claim `aud`
do JWT.

| | **Centralizado** (SaaS/integradora) | **Distribuído** (on-premises) |
|---|---|---|
| Grant | `client_credentials` | `authorization_code` + `refresh_token` |
| Credenciais | **1 par** para todas as lojas (env do app) | por loja |
| Vínculo | lojista autoriza o app no Portal do Parceiro dele | idem, via `userCode` |
| Webhook | disponível (1 por app) | ❌ indisponível — só polling |
| Descoberta | `GET /merchant/v1.0/merchants` lista as autorizadas | uma por autorização |
| Rate limit | **do app** (todas as lojas dividem a cota) | por loja |
| Estado a guardar | `merchantId` ↔ conta | `merchantId` + **`refreshToken`** |

**Fluxo `userCode`** (o handshake que vincula app ↔ loja):
`POST /oauth/userCode` com `clientId` → devolve `userCode` (ex. `HJLX-LPSQ`),
`authorizationCodeVerifier`, `verificationUrl` e `expiresIn: 600` (**10 min**) →
o lojista digita o código no Portal do Parceiro e concede as permissões → o app
troca por token com `grantType=authorization_code` (+ `refreshToken`).

**Regras operacionais:**

- Renovar o token **proativamente** (< 60 min do fim), com *single-flight* —
  pedir token por request é anti-padrão e consome rate limit.
- **`401` ≠ `403`**: `401` = token expirado (renova e segue); **`403` = aquele
  lojista revogou o app** → marcar só a conta dele como desconectada, nunca
  derrubar os outros tenants.
- No centralizado, o token **não escopa nada sozinho** — quem escopa é o
  `merchantId` no path de cada chamada. Errar o merchant = escrever no cardápio
  da loja errada.
- **Sync de catálogo tem que passar por fila com throttle global**, abaixo do
  polling de pedidos na prioridade: a cota é do app, então um cliente sincronizando
  cardápio pode estrangular os pedidos de todos os outros.

## 8. Resultados dos testes ao vivo (loja de teste, 2026-07-24)

App **Teste (C) — Centralizado** (`b95f3eaa-…`), loja `77e41b59-…`
("Teste - SISTER TECNOLOGIA LTDA"). Bancada: `C:\Orzuni\testes-ifood.mjs`.

| # | Pergunta | Resultado |
|---|---|---|
| 1 | Escopos do app | ✅ `aud` traz **13 escopos**, incluindo `catalog`, `order`, `merchant`, `events`, `promotion`, `review`, `financial`, `shipping`, `logistics`, `picking`, `item`, `groceries` |
| 2 | Versão do catálogo | ✅ **`"v2"`** — todos os endpoints deste doc valem |
| 3 | Contextos | ⚠️ a loja tem **um único catálogo** com `context: ["DEFAULT"]` (só entrega). Não dá para testar preço por canal aqui |
| 4 | `unsellableItems` | ✅ responde `200` com `{"categories":[]}` quando nada está pausado |
| 5 | Latência | 140–340 ms por chamada; **nenhum header de rate limit** foi devolvido |
| 6 | Webhook | desativado no app de teste (irrelevante: não há evento de catálogo) |

**Cardápio da loja de teste:** 1 categoria (`Os Mais Pedidos`, template `DEFAULT`),
3 itens (Trio 08 / 02 / 11), cada um com 2 grupos de complementos
(`Escolha batata`, `Bebida`), ambos `optionGroupType: INGREDIENTS` e `min:1 max:1`.
5 produtos no total (3 itens + batata grande/média). `shifts` 00:00–23:59 todos os
dias. Imagens hospedadas em `static-images.ifood.com.br`.

### ⚠️ Achado que ameaça o "modo ponte"

O código de PDV **não está no produto nem na raiz do item** — ele vive **dentro do
`contextModifiers`** do item:

```json
"item": {
  "id": "5e063e53-…", "productId": "18d67959-…", "status": "AVAILABLE",
  "contextModifiers": [
    { "catalogContext": "DEFAULT", "externalCode": "cw4620855",
      "price": { "value": 32.5 }, "status": "AVAILABLE",
      "itemContextId": "ec65cafd-…" }
  ]
}
```

E `GET /merchants/{m}/products/externalCode/cw4620855` devolve **`[]`** — porque
esse endpoint procura pelo `externalCode` **do produto**, que aqui está vazio.

### ⚠️ `PUT /items` é assíncrono — "concurrently modified" (ensaio homologação)

Criar um item e **atualizá-lo no mesmo instante** dá `400 BadRequest "Item ... is
being concurrently modified"`. O create ainda está sendo processado quando o update
chega. Esperar ~5s entre criar e atualizar resolve (confirmado). Implicações para o
Orzuni: o "publicar" do editor deve, ao criar um item, **não permitir re-edição
imediata** OU **retentar em 'concurrently modified' com backoff**. Numa sessão de
homologação com humano clicando o gap natural já basta.

### Ensaio de homologação do Catalog (2026-07-24) — todos os fluxos ✅

Rodado contra a loja de teste, na ordem que o analista valida (`homolog-catalog.mjs`):
listar catálogos (v2) · listar categorias · **criar categoria (POST)** · **criar item
com produto + grupo de complementos + opção (PUT)** · **atualizar via PUT, não POST**
(com espera) · preço via PATCH · **pausar (PATCH status, refletiu UNAVAILABLE)** ·
**reativar**. Tudo limpo ao fim. Tecnicamente pronto — falta só o gate: CNPJ + app de
produção + agendamento.

### Testes de ESCRITA (loja de teste, 2026-07-24) — resultados

Todos revertidos ao fim; a loja voltou ao estado inicial (3 itens, preços
originais, `unsellableItems` vazio).

| Pergunta | Resultado |
|---|---|
| **Modo ponte** — `PATCH /products/price` casa por `externalCode` do item? | ✅ **SIM.** `[{externalCode:"cw4620855", price:{value:33.5}}]` → `202` + `batchId` → lote `COMPLETED`/`SUCCESS`; preço mudou 32,5→33,5. **A ponte funciona sem conhecer id do iFood.** O `GET /products/externalCode/{c}` devolver `[]` é irrelevante — aquele endpoint busca o código do *produto*, o repreço casa o código do *item*. |
| Lote é assíncrono? | ✅ `202` imediato, resultado em `GET /batch/{id}` (`batchStatus: COMPLETED`, `results[].result: SUCCESS`). |
| **`PUT /items` respeita o `item.id`?** | ✅ **Item novo: SIM** (id enviado = id devolvido). Contradiz o relato de terceiro. **Para atualizar, reenviar o MESMO id.** |
| Reenviar com id NOVO + `externalCode` existente? | ⛔ `409 Conflict` — e o erro **devolve o id do item existente** em `conflictingResources[]`. Ou seja: a reconciliação por `externalCode` sai de graça no próprio erro, sem GET extra. |
| **Cascata** — pausar complemento derruba o item pai? | ✅ **SIM, quando o grupo obrigatório fica SEM nenhuma opção disponível.** Pausar 1 de 2 opções (grupo `min:1`) **não** derruba (a outra ainda atende). Pausar as 2 → o item cai com `restrictions: ["OPTION_GROUP_WITHOUT_AVAILABLE_OPTIONS"]`. E o grupo é **compartilhado**: derrubou TODOS os itens que usam aquele grupo. |
| `unsellableItems` é imediato? | ⚠️ **NÃO — é eventual.** Logo após a mudança vem vazio; ~10 s depois reflete. **O vigia tem que reconsultar com atraso, não confiar na 1ª leitura pós-mudança.** |
| **Schema do `image/upload`** | ✅ body `{ "image": "data:image/jpeg;base64,…" }` (**data-URI**; base64 puro dá `NotABase64`) → `201` `{ "imagePath": "{merchantId}/{ts}_{hash}.jpeg" }`. O `imagePath` alimenta `products[].imagePath`. |
| Latência de escrita | 140–310 ms; **nenhum header de rate limit** em nenhuma resposta. |

### ⚠️ Reprecificar APAGA a promoção "de/por" (teste 2026-07-24)

Confirmado ao vivo: pus o Trio 08 em `de 32,50 por 29,90` (`price.value=29.9`,
`originalValue=32.5`) e reprecei pelo modo ponte (`PATCH /products/price` com só
`{value:31}`). Resultado: o **`originalValue` sumiu** no contexto de entrega — a
promoção evaporou. Causa: preço promocional = `value` + `originalValue` juntos;
reenviar só o `value` **substitui** o par e zera o `originalValue`. É o mesmo
comportamento do portal ("mudar preço tira da promoção").

Efeito colateral observado: `PATCH /products/price` mexeu só no **contexto**
DEFAULT e deixou a **raiz** do item com o `de/por` antigo → raiz e contexto
**dessincronizaram**. Reforça: sempre reprecificar com `catalogContext` explícito.

Promoção de **campanha** (módulo Promotion, legado) NÃO foi testada — provável que
saia também (portal = mesma API), mas confirmar antes de afirmar.

**Guardrail do Orzuni:** antes de reprecificar, ler o `originalValue` atual e
recarregá-lo no PATCH (preserva o de/por); e avisar o usuário quando o item estiver
em promoção. Vira feature de proteção que o portal não dá bem.

**Implicações para o Orzuni:**
- O modo ponte por `externalCode` está **provado ponta a ponta** — é a base da API aberta para ERP/CRM.
- `externalCode` é a chave; o `409` já entrega o id do conflito → reconciliação barata.
- **A cascata "complemento pausado derruba item" é o alerta mais valioso do vigia**, e `unsellableItems` a detecta (`OPTION_GROUP_WITHOUT_AVAILABLE_OPTIONS`) — mas com latência, então o polling precisa de janela de estabilização.
- Grupo de complementos é **compartilhado entre itens** → pausar/repausar uma opção tem efeito em cascata que a UI precisa mostrar ("esta opção afeta N itens").

## Fontes
- Portal oficial (bloqueia fetch automatizado; conferir logado):
  https://developer.ifood.com.br/pt-BR/docs/guides/modules/catalog/introduction ·
  `.../workflow` · `.../fundamentals` · `.../endpoints` · `.../homologation` ·
  `.../guides/{pizza,combo,availability,modifiers-management,multisetup,common-patterns}` ·
  swagger: https://developer.ifood.com.br/pt-BR/docs/references
- Espelhos públicos da doc + coleção Postman oficial do Catalog v2 (40 endpoints):
  `github.com/lucasmonstrox/menupiloto` (`docs/integracoes/ifood/api/catalog/`) e
  `github.com/saulollacerda/MenuBank` (`.claude/docs/integrations/ifood/CATALOG.md`).
- Payload real da nossa loja de teste (`GET /catalogs`, `GET /events:polling`).
