# Regem × GoGeM — Contrato de Integração (ENDPOINTS)

> Gerado por Claude Code a partir do código-fonte do Regem em **2026-07-24**. Commit base: **`65a98de`**.
> Todo endpoint marcado ✅ foi confirmado abrindo o handler/serviço real (método, path e campos do payload conferidos contra o código). Onde falta capacidade, está marcado `LACUNA:` seguido da proposta mínima.
> Todos os paths são relativos ao prefixo global **`/api/v1`** (`backend/src/main.ts:71`).

---

## 0. Visão geral técnica

| Item | Valor |
|---|---|
| **Framework/linguagem** | NestJS 10 + TypeScript. Bootstrap em `backend/src/main.ts`. |
| **Padrão de rotas** | Controllers por domínio em `backend/src/modules/<dominio>/<dominio>.controller.ts` (um módulo por domínio: controller + service + dto). ~70 controllers. |
| **Prefixo/versão** | `app.setGlobalPrefix('api/v1')` (`main.ts:71`). Toda rota nasce sob `/api/v1`. Breaking change ⇒ nova versão. |
| **Validação** | `ValidationPipe({ whitelist: true, transform: true })` global (`main.ts:74`) — campos fora do DTO são descartados. |
| **Autenticação padrão** | JWT **Bearer** (`Authorization: Bearer <token>`), HS256, `expiresIn: '12h'` (`auth.module.ts:18`). Guard revalida no banco a cada 30s (`jwt-auth.guard.ts:16,57`). |
| **Contrato/doc** | Swagger em `/api/v1/docs` (produção só com `SWAGGER_ENABLED=true`, `main.ts:77`). `addBearerAuth()`. |
| **Banco e ORM** | PostgreSQL (Supabase na nuvem / Postgres embarcado no edge) via **Drizzle ORM** + `pg`. Schema único em `backend/src/db/schema.ts`. Saldos de estoque e caixa são **derivados de ledger** (não há coluna de saldo). |
| **Segurança de borda** | `helmet()` (`main.ts:57`); CORS por env `CORS_ORIGIN` (`main.ts:62`); `rawBody: true` para assinatura de webhook; segredos `.env` podem ser cifrados com DPAPI no edge (`carregarEnvSeguro`). |
| **Multiempresa** | `tenant_id` em toda tabela de negócio; resolvido do **JWT** (claim `tenant`), nunca do body. `unidade_id` (= "loja") resolvido por `@UnidadeAtual()` (`unidade-atual.decorator.ts`): usuário preso à sua unidade; `presidente` lê header `X-Unidade-Id` (ou `null`=todas); perfil sem unidade → `NIL_UUID` fail-closed. `terminal_id` via header `X-Terminal-Id` (`terminal-atual.decorator.ts`). |

**Modelo de dados canônico relevante:** dinheiro do **catálogo** em **reais decimais** (colunas `numeric`, ex. `precoVenda`); o **fechamento de caixa** faz a conta em **centavos** internamente (`paraCentavos`). Converter na borda do GoGeM.

---

## 1. Autenticação de serviço (máquina-a-máquina)

**Não existe grant `client_credentials` / OAuth de aplicativo terceiro.** Há quatro mecanismos não-humanos; o adequado para o GoGeM é o **sync token de dispositivo**.

| Item | Valor |
|---|---|
| **Endpoint de token** | **LACUNA** (não há emissor OAuth M2M). O dispositivo é **provisionado**, não faz login. |
| **Mecanismo recomendado** | **`X-Sync-Token`** (dispositivo `equipamento` tipo `servidor_local`). |
| **Guard** | `SyncTokenGuard` (`backend/src/modules/sync/sync-token.guard.ts:18`). Header `x-sync-token` → `equipamento.service.ts:254 validarToken` (match exato em `equipamento.token`, precisa `ativo`; coluna `unique`, `schema.ts:752`). |
| **Escopo** | Nível-dispositivo, revogável. `req.sync = { tenantId, unidadeId, equipamentoId }` — **tenant derivado do dispositivo, não spoofável pelo body**. Injeta via `@SyncCtx()`. |
| **Onde já é usado** | Telemetria/comandos do edge (`edge.controller.ts:83,109`), ingest de pedidos (`delivery.controller.ts:29`), resultado de TEF (`tef.controller.ts:86`), handshake do Socket.IO. |

**Bootstrap (pareamento por código) — PÚBLICO ✅**
- `POST /api/v1/publico/terminal/parear` (`pareamento.controller.ts:9`, `@Throttle 10/60s`). Body `{ codigo }` (6 dígitos, uso único, expira 15 min). Retorna **uma vez** um segredo hex de 32 bytes (`equipamento.service.ts:74`). É o enrolamento que gera o segredo do terminal.

**Outros mecanismos (contexto, não usar no GoGeM):**
- **Terminal pareado** — `TerminalSegredoInterceptor` (`auth/terminal-segredo.interceptor.ts:25`): headers `X-Terminal-Id` + `X-Terminal-Secret`, valida `segredoHash` (SHA). É **acompanhante de um JWT humano**, não auth de serviço isolada. ⚠️ *hole* de retrocompat: device pré-mig 142 com `segredoHash == null` passa sem segredo (`equipamento.service.ts:131`).
- **Console de distribuição** — `DistribuicaoGuard` (`distribuicao/distribuicao.guard.ts:21`): Bearer com **segredo separado** `DIST_JWT_SECRET`, claim `escopo === 'distribuicao'`, cross-tenant, cloud-only. Não é para o GoGeM.
- **JWT humano** — `POST /api/v1/auth/login` (email|usuario+senha), `/auth/pin`, `/auth/register`, `/auth/senha` (todos `@Throttle 5/60s`, `auth.controller.ts:16-42`). Payload JWT (`auth.service.ts:393`): `{ sub, tenant, cat, setor, uni, perm, nome, func }`. Resposta `{ access_token, user }`.

**LACUNA:** para um produto de terceiro (GoGeM SaaS multi-loja) o ideal é um **client-credentials com escopos** (`catalog:read`, `sale:write`) ou, no mínimo, **provisionar o totem como `equipamento` tipo `servidor_local`/`totem` e autenticar por `X-Sync-Token`** — reaproveita `SyncTokenGuard` (tenant server-side, revogável) sem inventar auth nova. Recomendação: **reusar o sync token no piloto**; evoluir para client-credentials quando abrir a API pública (S12).

---

## 2. Catálogo (leitura)

Controller `@Controller('produtos')` sob `JwtAuthGuard + RolesGuard` (`produto.controller.ts:23`). **Nenhum GET de catálogo é público** (só o menu tokenizado da §2.6). Sem paginação e sem filtros de query — cada endpoint filtra por `tenantId` do token.

### 2.1 Produtos ✅
- `GET /api/v1/produtos` (`produto.controller.ts:159`) — lista. Resposta real (SELECT `produto.service.ts:580`):
  ```
  id, codigo, nome, descricao, tipo, unidadeMedida, precoVenda, precoCusto,
  controlaEstoque, validadeDias, vaiParaProducao, controlaValidade,
  validadeFechadoDias, validadeAbertoDias, disponivelCardapio, pausadoEstoque,
  pausaMotivo, permiteNegativo, disponivelBalcao, ativo, categoriaId, fichaId,
  setorProducaoId, imagemRef, categoriaNome, fichaNome
  ```
- `GET /api/v1/produtos/:id` (`produto.controller.ts:164`, `getOne` service:604) — row inteira de `produto` + `variacoes[]`, `combo[]`, `complementos[]` (grupos+opções), `faixas[]`, `sugestoes[]`.
- ⭐ **Este é o par de endpoints do de-para** — são os únicos que trazem o `codigo` (PDV) e o `codigoPdv` das opções. O menu público (§2.6) **oculta** esses códigos.

- **Campo do código PDV (tabela.coluna): `produto.codigo`** (`schema.ts:1144` — `text('codigo')`, comentário "SKU / índice p/ integrações").
  - Tipo `text` (string livre, **não** UUID); **nullable**.
  - **Único por tenant**, índice parcial: `create unique index idx_produto_codigo on produto (tenant_id, codigo) where codigo is not null and deleted_at is null` (`database/migrations/021_produtos.sql:44`). Não é único por unidade.
  - **De-para recomendado: casar por `(tenantId, codigo)`.** Tratar `codigo` nulo como produto sem PDV (não casável). Existe `produto.unidadeId` (`schema.ts:1143`) mas **não** entra na chave e é opcional.

### 2.2 Categorias ✅
- Tabela **`categoria_produto`** (`schema.ts:1120`) — *é a própria tabela de categorias* (nome enganoso; não é uma N:N). Campos: `id, tenantId, nome, parentId (subcategoria), ordem, ativo, imagemRef, descricao, disponibilidade (jsonb de janelas), timestamps, deletedAt`.
- Ligação: **escalar** `produto.categoriaId → categoria_produto.id` (`schema.ts:1147`). Um produto pertence a **uma** categoria. Categoria é **obrigatória** no cadastro (`produto.service.ts:833`).
- `GET /api/v1/produtos/categorias` (`produto.controller.ts:28`) → todas as colunas de `categoria_produto`.

### 2.3 Complementos/adicionais ✅
Dois níveis: **catálogo reutilizável** (migs 113-116) e **motor materializado** (o que o pedido/menu lê).
- Reutilizável: `opcao` (`schema.ts:1500`), `complemento`=etapa (`1524`: `regra`, `obrigatorio`, `min`, `max`, `canais`), `complemento_item` (`1541`: liga complemento↔opção, carrega `preco`), `produto_complemento` (`1557`: liga produto↔complemento com `ordem`).
- Materializado (ler): `complemento_grupo` (`schema.ts:1571`: `produtoId, nome, tipo(remover|adicionar|escolha), min, max, obrigatorio, ordem`) e `complemento_opcao` (`1589`: `grupoId, nome, precoDelta, produtoRefId, itemId, quantidade, codigoPdv, controlaEstoque, padraoMarcada, ordem`).
- Leitura: `GET /api/v1/produtos/:id/complementos` (`produto.controller.ts:203`, `complementosDe` service:717) → `grupos:[{...grupo, opcoes:[{nome, precoDelta, codigoPdv, controlaEstoque, padraoMarcada, quantidade, ordem}]}]`.
- **Preço da opção = `complemento_opcao.precoDelta`** (é **delta/acréscimo**, não absoluto). **Código PDV da opção = `complemento_opcao.codigoPdv`** (`schema.ts:1602`, nullable).
- **Regra confirmada (mig 126):** opção **sem** `codigoPdv` é **informativa** (ex. "ponto da carne", "talheres") — não baixa estoque, não soma preço (`produto.service.ts:320`; `const informativa = !(it.codigoPdv ?? '').trim();`). O menu público expõe só o booleano `informativa`, escondendo o código.

### 2.4 Preços e listas de preço ✅
- **Formato: DECIMAL em reais** (colunas `numeric`, retornadas como string, convertidas com `Number(...)`). Não há divisão por 100 na leitura do catálogo.
- Produto: `precoVenda` (`schema.ts:1151`, notNull default '0'), `precoCusto` (`1152`), `precoPromocional` (`1163`).
- **Preço por loja (per-unidade)? NÃO.** Um único `precoVenda` por registro de produto; não há tabela de preço por unidade.
- `produto_faixa_preco` (`schema.ts:2154`: `qtdMin, preco, ordem`) é **desconto por volume (B2B)**, não preço por loja. Variações (`produto_variacao`) têm `precoVenda` próprio por SKU.

### 2.5 Disponibilidade/estoque consultável ✅
- Flags no produto: `disponivelCardapio` (`schema.ts:1165`), `disponivelBalcao` (`1169`), `pausadoEstoque`+`pausaMotivo` (`1166`), `permiteNegativo` (`1168`), `ativo` (`1188`), `deletedAt`.
- Derivado `esgotado` (menu público, `cardapio.service.ts:919`): `esgotado = semEstoque || disponivelCardapio===false || pausadoEstoque===true`, onde `semEstoque` vem de `computeEsgotados` explodindo a ficha até o insumo no ledger `movimento_estoque` (saldo ≤ 0 e não `permiteNegativo`).
- ⚠️ **Não há endpoint de "saldo por produto"** — saldo existe só a nível de **insumo** (§4). Ver LACUNA abaixo.

### 2.6 Menu público (tokenizado) ✅
- `GET /api/v1/publico/cardapio/:token` (`cardapio.controller.ts:27`, service `menu()` :743) — **público, sem JWT**. `:token` = `cardapio_config.token` (12 hex, exige `ativo`).
- Payload rico: `loja{...}`, `categorias[{id,nome,descricao,imagemRef}]`, `produtos[{id,nome,descricao,precoVenda,precoDe,categoriaId,imagemRef,selos[],esgotado, variacoes[], grupos[{id,nome,tipo,min,max,obrigatorio, opcoes[{id,nome,precoDelta,informativa,padraoMarcada}]}]}]`, `banners[]`, `horarios[]`, `bairros[]`.
- ⚠️ **Limitação crítica p/ o de-para:** o menu público **NÃO inclui `produto.codigo` nem os `codigoPdv` das opções** (só o booleano `informativa`). Serve para **renderizar** o cardápio, não para casar por código PDV. Para o de-para, usar `GET /produtos` autenticado.

### LACUNAS do catálogo
- **L-CAT-1:** o menu público não expõe `codigo`/`codigoPdv`. Se o GoGeM só puder usar o token público, precisa adicionar esses campos ao payload de `menu()`. *(P — se optar pelo caminho público)*
- **L-CAT-2 (baixo custo, alto valor):** não há **endpoint de leitura autenticado por `X-Sync-Token`** (os GET de produtos exigem JWT humano). O import inicial do GoGeM precisará ou de um JWT de serviço ou de um `GET /produtos` aceitando o sync token. *(M)*
- **L-CAT-3:** sem "saldo/disponibilidade por produto" consultável (ver §4/L-EST-1).

---

## 3. Lançamento de venda (escrita) — CRÍTICO

Há **três** caminhos de escrita de venda. Nenhum, hoje, modela exatamente "venda de totem **paga** com split de pagamento + CPF, casada por `codigo_pdv`, com efeito imediato em caixa/estoque/fiscal". Resumo:

| Caminho | Auth | Item por | Idempotência | Caixa | Estoque | Fiscal | Split pgto | CPF |
|---|---|---|---|---|---|---|---|---|
| `POST /vendas/balcao` (`vendaBalcao`) | JWT + `pdv` | **`produtoId` (UUID interno)** | ✅ `idempotencyKey` | exige sessão aberta | imediato | sim | **sim** (`pagamentos[]`) | ❌ |
| `POST /delivery/ingest` (`ingest`→`venderExterno`) | **`X-Sync-Token`** | **`codigo` (PDV)** ou `produtoId` | ✅ por `externalId` | **sem sessão** (pré-pago) | **só na conclusão** | sim (se ativo) | ❌ (forma única) | ❌ |
| `fecharComanda`/`fecharMesa` | JWT + `mesas` | comanda já aberta | id da comanda | exige sessão | imediato | sim | mesa: forma única | ❌ |

### 3.1 Venda de balcão (o modelo de "venda paga") ✅
- `POST /api/v1/vendas/balcao` (`vendas.controller.ts:31`, `@RequirePerm('pdv')`, guards `JwtAuthGuard, RolesGuard, PermissoesGuard`). Injeta `@CurrentUser`, `@TerminalAtual` (`X-Terminal-Id`), body `VendaBalcaoDto`.
- **DTO real** (`dto/venda-balcao.dto.ts`):
  - `VendaBalcaoDto`: `itens: VendaItemDto[]`; `forma?: 'dinheiro'|'pix'|'cartao'|'transferencia'`; `pagamentos?: PagamentoDto[]` (split); `taxaServicoPct?: number`; `mesa?: string`; `unidadeId?: string`; **`idempotencyKey?: string`** ("offline-first").
  - `VendaItemDto`: **`produtoId: string` (UUID interno — NÃO `codigo_pdv`)**; `variacaoId?`; `quantidade`; `complementos?: string[]` (UUIDs de opção); `observacao?`.
  - `PagamentoDto`: `forma: string`; `valor: number`; `formaPagamentoId?: string`.
- **Grava:** `comanda` (status `'fechada'` = o "cupom", `vendas.service.ts:347`), `comandaItem` por linha (`:404`, snapshot `descricao`/`precoUnitario` calculados no servidor), `comandaItemComplemento` (`:420`), `movimentoEstoque` saída (`:458`), `lancamentoCaixa` **um por forma** (`:500`), ordens de produção (`:461`), `auditLog` (`:558`).
- **Retorno:** `{ comandaId, senha, subtotal, taxaServicoPct, total, producaoPayloads, viaClienteItens, unidadeId, nfce:{status,chave,numero}|null }` (`:530`). Replay idempotente ⇒ `{ comandaId, idempotente: true }` (`:331`).
- **Identificador do lançamento no Regem = `comandaId`** (comanda em `'fechada'`); id humano = `senha`.
- ❌ **CPF não é capturado** — nem no DTO nem na tabela `comanda` (grep de `cpf` só acha regex de redação LGPD no edge). **CPF-na-nota é lacuna de todo o caminho de venda.**

### 3.2 Pedido de origem externa (o caminho reutilizável) ✅
Todos os canais (iFood, Anota Aí, 99food, Cardápio Web, Open Delivery, manual) convergem em **um método genérico**: `DeliveryService.ingest()` (`delivery.service.ts:276`).
- **`POST /api/v1/delivery/ingest`** (`delivery.controller.ts:29`) — **`SyncTokenGuard`** (não JWT). Body `{ canal, pedido }`. Tenant/unidade vêm do dispositivo.
- **Shape normalizado** `PedidoNormalizado` (`adapters.ts:6`): `externalId?, displayId?, clienteNome?, clienteTelefone?, tipo:'entrega'|'retirada', endereco?, itens:[{ produtoId?, codigo?, descricao, quantidade, precoUnitario, observacao? }], total, formaPagamento?` — **itens carregam `codigo` (PDV) OU `produtoId`**; pagamento é **string única** (sem split).
- **Materialização:** `ingest` insere `pedido_externo` status `'novo'` (`schema.ts:1868`; default `statusPagamento:'na_entrega'`, `pago:false`). Vira comanda em `aceitar()` (`:470`, auto se `cfg.autoAceitar` e sem edge ativo). Mapeamento item→produto (`:498`): **por `codigo` primeiro, depois por nome** — `porCodigo = Map(prods.filter(p=>p.codigo)...)`. `aceitar` chama `vendas.venderExterno()` (`vendas.service.ts:643`): insere `comanda` `'fechada'` (`forma` = plataforma ou `'online'`), `comandaItem` (produtoId pode ser null → linha livre), `lancamentoCaixa` **sem `sessaoId`** (`:743`, "delivery é pré-pago"). **Estoque baixa só na conclusão** via `baixarEstoqueExterno` (`:876`).
- **Deferral no edge:** se há heartbeat de edge vivo, a nuvem pula a materialização (`deferirParaEdge` `:262`) e o edge processa.

### 3.3 Idempotência da venda ✅
- `vendaBalcao`: **presente e robusta** — `idempotencyKey` (pré-check `:321` + captura `23505` `:543`); coluna `comanda.idempotency_key` com índice parcial único `idx_comanda_idempotency (tenant_id, idempotency_key)` (`migrations/029_revisao_geral.sql:13`).
- `ingest`: dedupe por `externalId` por `(tenant, canal, externalId)` (`:316`). ⚠️ O controller `/delivery/ingest` **não repassa `clientRef`** — do endpoint, o dedupe depende do GoGeM enviar um **`externalId`/`id` estável** no `pedido`.
- **Não há convenção de header `Idempotency-Key`** genérico — é sempre um **campo no body** por endpoint.

### 3.4 Side effects de uma venda de balcão ✅
| Efeito | Onde | Nota |
|---|---|---|
| Estoque (ficha) | `acumularProduto` `:435` → `lancarSaidas` `:458` | `movimentoEstoque` saída, `onConflictDoNothing`; emite `estoque.baixado` |
| Caixa | exige sessão aberta (`:338`, "Abra o caixa"); `lancamentoCaixa` `:500/515` | balcão **requer** `caixa_sessao` origem `pdv` aberta |
| Financeiro | mesmos `lancamentoCaixa` categoria `venda` | sem tabela financeira separada |
| Fiscal | `fiscal.emitirSeAtivo(...)` `:590` | não-bloqueante; só se fiscal ativo na unidade |
| Cashback/fidelidade | **NÃO** no balcão | só no `aceitar` externo (`delivery.service.ts:541`) |
| Impressão | `imprimirViaCliente` `:574` | via do cliente na impressora `cupom` do terminal |
| KDS/produção | `producao.criarPedidos` `:461` + `emitirNovos` `:570` | ordens duráveis roteadas por destino do produto |

### VERDICT + LACUNA/proposta
- **Existe** um ingest externo reutilizável, autenticado por dispositivo, casando por `codigo_pdv` e idempotente: `POST /api/v1/delivery/ingest`. É exatamente como iFood/Anota Aí/99food já lançam. **Serve para "totem como canal de delivery/pré-pago".**
- **Não existe** um endpoint que lance uma **venda de PDV concluída e paga** (split de tender + CPF opcional + efeito **imediato** de caixa/estoque/fiscal) **por `codigo_pdv`** e autenticada por dispositivo. `vendaBalcao` modela a venda paga, mas exige **JWT com perm `pdv`**, **sessão de caixa aberta** e **itens por `produtoId` UUID**.
- **`LACUNA` (prioridade #1 do piloto):** criar um **adaptador fino** `POST /api/v1/vendas/externa-pdv` (ou estender `venderExterno`) que:
  1. autentica por `X-Sync-Token` (dispositivo → tenant);
  2. aceita itens por **`codigo_pdv`** (reusa `porCodigo` do `delivery.service`);
  3. aceita **`pagamentos[]`** (split, forma+valor+NSU/autorização) e marca `pago:true`;
  4. aceita **`cpf?`** e **`idempotencyKey`** (chave única do totem);
  5. decide o modelo de caixa (ver §5) e dispara estoque + fiscal imediatos.
  Assinatura sugerida no §9. É **pequeno** — é um adaptador sobre `venderExterno`/`vendaBalcao`, não construção do zero.

---

## 4. Estoque / ficha técnica

### 4.1 Baixa automática na venda — EXISTS ✅
Explosão recursiva da ficha em insumos, gravando `movimento_estoque` tipo `saida`:
- `vendaBalcao` → `acumularProduto` (`vendas.service.ts:125`) → `acumularFicha` (recursiva, `:61`: `consumo = quantidade * fatorCorrecao / rendimento * multiplicador`, sub-fichas recursam, ciclos protegidos) → `lancarSaidas` (`:196`, insere `movimentoEstoque {tipo:'saida', motivo:'venda', refTipo:'venda', refId:comandaId}` com `onConflictDoNothing`, idempotente por `idx_movimento_ref`).
- **Timing (importante p/ totem):** balcão/mesa baixa **no fechamento**; canal externo (`venderExterno`) **não** baixa no aceite — difere para a **conclusão** (`baixarEstoqueExterno` `:876`). O GoGeM precisa escolher o fluxo deliberadamente.

### 4.2 Consulta de saldo — por insumo EXISTS ✅ / por produto LACUNA
- `GET /api/v1/estoque/itens` (`estoque.service.ts:135`) — saldo **derivado do ledger** (`sum(entrada − saida ± ajuste)`). Row: `{id, nome, unidadeMedida, estoqueMinimo, custoMedio, categoriaItemId, fornecedorId, categoriaNome, fornecedorNome, saldo, valorEstoque, conversoes[]}` (`custoMedio`/`valorEstoque` nulos sem `ver_financeiro`).
- Também: `GET /estoque/inteligencia` (ROP, cobertura, ABC), `/estoque/validades` (FEFO), `/estoque/cmv` (perm financeiro), `/estoque/movimentos?itemId`, `/estoque/alertas`.
- **L-EST-1 (LACUNA):** **não há endpoint de saldo por produto** (o saldo vive só no insumo `item_estoque`). A disponibilidade do produto é recomputada indiretamente. Para o totem perguntar "este produto está disponível?", ou consumir `esgotado` do menu público, ou criar um `GET /produtos/:id/disponibilidade`. *(P/M)*

### 4.3 Ligação produto ↔ insumo (via ficha) — EXISTS ✅
Cadeia: **`produto.fichaId` (`schema.ts:1148`) → `ficha_tecnica` (`1033`: `rendimento`, `metaCmv`) → `ficha_ingrediente` (`1058`: `itemId` **ou** `subFichaId`, mutuamente exclusivos) → `item_estoque`**. Produtos nunca referenciam insumo direto. Contagem gera `movimentoEstoque {tipo:'ajuste'}` (`contagem.service.ts:232`).

---

## 5. Fechamento de caixa

### 5.1 Modelo — EXISTS ✅
- **`caixa_sessao`** (`schema.ts:872`): `{unidadeId, terminalId, origem('pdv'|'delivery'), status('aberta'|'fechada'), turnoNumero, valorAbertura, valorInformado, valorEsperado, diferenca, valoresInformados(jsonb por forma), esperadoPorForma, diferencaPorForma, fechadaEm/PorId, obs}`. **Balcão = sessão por terminal**; **delivery = uma gaveta separada** (`terminalId` null, `origem='delivery'`).
- **`lancamento_caixa`** (`schema.ts:851`): `{unidadeId, tituloId, tipo(entrada|saida), valor, data, categoria, forma, descricao, estornoDe, sessaoId, comandaId, criadoPorId}`. Venda insere **um lançamento por forma** (`vendas.service.ts:500`).

### 5.2 Endpoints (`/api/v1/financeiro/...`) ✅
- `GET /caixa?origem=` — sessão aberta + operador (`financeiro.controller.ts:112`).
- `POST /caixa/abrir` — abre (terminalId via `@TerminalAtual`) (`:126`).
- `POST /caixa/movimentar` — sangria/suprimento (`:139`).
- `POST /caixa/fechar` — **fechamento cego** (`:202`, `fecharSessao` `:690`): operador informa `valoresInformados:{dinheiro,pix,...}`; esperado por forma = soma dos `lancamento_caixa` da sessão. Retorno `{esperado, informado, diferenca, esperadoPorForma, informadoPorForma, diferencaPorForma, formas[], alertou, limite, sessao{...}}`. Diferença > `limiteDiferencaCaixa` (default R$5) cria `ocorrencia` + audit.
- `GET /caixa/fechamentos?inicio&fim` — relatório de sessões fechadas (role presidente/gerente + perm `turnos`) (`:218`).

### 5.3 Totem no fechamento — PARTIAL / LACUNA
- Eixos de quebra hoje: **`origem` (pdv|delivery)**, **`terminalId`**, **`forma`**. Não há coluna de **canal/plataforma** em `lancamento_caixa`.
- Venda externa (`venderExterno`) insere lançamento com `sessaoId` **null** (`vendas.service.ts:743`) ⇒ **receita de totem NÃO entra em nenhum `caixa_sessao`** se lançada como externo; aparece só nos relatórios de fluxo/DRE, invisível ao fechamento de gaveta.
- **L-CX-1 (decisão de arquitetura):**
  - **(a)** Parear o totem como **terminal `pdv`** ⇒ ganha sessão de caixa própria (split por terminal sai de graça). Simples, recomendado quando o totem tem gaveta/pagamento local.
  - **(b)** Se o totem for pré-pago (TEF/PIX sem gaveta), adicionar uma **dimensão de origem/canal** em `lancamento_caixa` para o fechamento discriminar "totem". *(M)*

---

## 6. Fiscal

### 6.1 Estado real — PARTIAL ✅/LACUNA
NFC-e (modelo 65) **totalmente modelada**, pipeline roda ponta a ponta, mas **a transmissão real à SEFAZ é stub**:
- Seleção do transmissor (`fiscal.service.ts:48`): `config.certRef ? SefazDireto : SefazMock`.
  - **`SefazMockTransmitter`** (`transmitter.ts:32`) — retorna `status:'autorizada'` com protocolo falso, **não toca a SEFAZ** (caminho ativo hoje).
  - **`SefazDiretoTransmitter`** (`transmitter.ts:57`) — **lança** "SEFAZ direto não configurado: plugue o certificado A1 e a assinatura/transmissão." É o **ponto de plugue** (A1 + XML-DSig + SOAP). **LACUNA:** transmissão real não implementada.
- Chave/XML/QR são reais (`chave.ts`, `nfce-xml.builder.ts`); URL do QR **hardcoded SP** (`fiscal.service.ts:31`) — precisa de trabalho por UF.

### 6.2 Endpoints (`/api/v1/fiscal/...`) ✅
- `POST /fiscal/comandas/:id/emitir` — emite NFC-e da comanda (`:48`, `emitir` service `:153`).
- **Automático após a venda:** `fiscal.emitirSeAtivo` (`fiscal.service.ts:318`) chamado por `vendaBalcao` (`:590`) e `venderExterno` (`:759`) — só se `fiscalConfig.ativo`; nunca bloqueia; erro ⇒ nota `rejeitada`. `vendaBalcao` retorna `nfce:{status,chave,numero}`.
- `GET /fiscal/notas` (perm `fiscal`) → `{id, numero, serie, chave, status, ambiente, valorTotal, motivo, emitidaEm, comandaId}` (`:393`).
- `GET /fiscal/notas/:id` — row completa com `xml`, `qrcode`, `protocolo` (`:59`).
- `POST /fiscal/notas/:id/cancelar` (presidente/gerente, justificativa ≥15) (`:65`).
- `GET/PUT /fiscal/config` (PUT presidente; CSC mascarado na leitura).

### 6.3 Dados p/ DANFE — EXISTS ✅
`nota_fiscal` (`schema.ts:1810`) guarda tudo: **`chave, qrcode, protocolo, serie, numero, xml, valorTotal, ambiente, status, motivo`**. `imprimirDanfe` (`fiscal.service.ts:422`) renderiza cupom texto (banner "*** HOMOLOGACAO - SEM VALOR FISCAL ***" quando `ambiente='2'`) e enfileira `impressao_job via:'fiscal'`. Emissão exige **NCM em todo produto** (`:195`) e puxa campos fiscais do `produto` (ncm, cfop, cest, origem, csosn, cstIcms, aliqIcms, gtin, cstPis, cstCofins…).

### 6.4 SAT / TEF
- **SAT-CF-e: AUSENTE** — só NFC-e modelo 65.
- **TEF: PARTIAL** — o backend é **camada de registro/orquestração**, não driver. PDV cria `pagamento_tef` (`schema.ts:2053`) `status:'pendente'`; o **agente de edge** (auth `X-Sync-Token`) faz `GET /api/v1/tef/pendentes` e `POST /api/v1/tef/:id/resultado` com `{status, nsu, autorizacao, bandeira, mensagem}` (`tef.controller.ts:86`). `tef_config.provedor` ∈ `mock|sitef|paygo|stone`, mas **nenhum SDK de adquirente está integrado no backend** — tudo delegado ao edge. `pagamento_tef` é **separado** de `lancamento_caixa`; liga à comanda por `vincularComanda`.

### LACUNAS fiscais
- **L-FIS-1:** transmissão real SEFAZ (`SefazDireto`) — cert A1, assinatura, SOAP, por UF. *(G — fora do escopo do piloto se o totem operar em "modo sem fiscal" ou "fiscal no integrado/Regem")*
- **L-FIS-2:** para o GoGeM emitir a partir de venda externa, `emitirSeAtivo` já cobre (dispara no `venderExterno`); falta só o CPF na nota (ligado à L-VEN-CPF).

---

## 7. Eventos / Webhooks

- **Barramento externo / assinatura: AUSENTE.** Não há produto de webhook de saída que um terceiro registre; URLs de webhook das plataformas são configuradas manualmente em cada portal.
- **Entrada (externo → Regem):** 99food (`POST /api/v1/integracoes/99food/webhook`, **público, sem assinatura** ⚠️, tenant por `app_shop_id` no body) e Cardápio Web (`.../cardapio-web/webhook`, valida `X-Webhook-Token` mas **cai para loja única** se não bater ⚠️). iFood e Anota Aí são **polling** (`*.poller.ts`), sem controller de entrada.
- **Bus interno (in-process, não assinável):** `@nestjs/event-emitter` (`app.module.ts:81`) — `ponto.marcado`, `estoque.baixado`, `producao.evento`, `kds.alerta.*` etc. Memória, processo único.
- **Tempo real (assinável com credencial):** **Socket.IO** `realtime.gateway.ts:34`. Handshake aceita `auth.token` (sync token de dispositivo) **ou** `auth.jwt` (JWT humano); salas escopadas `tenant:<id>`, `unidade:<id>`. Um sistema externo **pode** consumir eventos ao vivo **se receber um sync token/JWT** — canal privado (KDS/PDV), não feed público.
- **LISTEN/NOTIFY no backend NestJS: AUSENTE** (o uso de LISTEN/NOTIFY é do worker de impressão do edge, não deste backend).
- Saída per-integração: Regem **empurra status de pedido de volta** às plataformas via API delas (ex. 99food `refletirStatusExterno`), hardcoded por plataforma — não é webhook genérico.

**LACUNA/proposta mínima:** para o GoGeM ter atualizações ao vivo (ex. status de pedido, "sold out" de produto), o caminho barato é **conectar ao Socket.IO com o sync token do totem** e ouvir a sala `tenant:<id>`. Se for preciso push HTTP para o backend do GoGeM (SaaS), propor um **registro de webhook** (`order.registered`, `stock.low`, `cashclosing.done`) emitido a partir do bus interno — hoje inexistente. *(M/G)*

---

## 8. Mapa de modelos (tabelas relevantes)

| Tabela (`schema.ts:linha`) | Campos-chave p/ integração | Observações |
|---|---|---|
| `produto` (1138) | **`codigo` (PDV)**, `precoVenda`, `categoriaId`, `fichaId`, `controlaEstoque`, `disponivelCardapio/Balcao`, `pausadoEstoque`, campos fiscais (ncm, cfop, cst…) | de-para por `(tenant_id, codigo)`; preço decimal reais |
| `categoria_produto` (1120) | `id`, `nome`, `parentId`, `ordem` | é a tabela de categorias (não N:N); produto→1 categoria |
| `complemento_grupo` (1571) / `complemento_opcao` (1589) | grupo: `produtoId, tipo, min, max, obrigatorio`; opção: **`codigoPdv`**, `precoDelta`, `informativa` | opção sem `codigoPdv` = informativa (não baixa/soma) |
| `comanda` (1263) | `status('fechada')`, **`idempotencyKey`**, `senha`, `total`, `forma`, `taxaServicoPct` | o "cupom"; `comandaId` é o id do lançamento; **sem CPF** |
| `comanda_item` (1292) / `comanda_pagamento` | linha por produto (snapshot preço); pagamento por forma | — |
| `pedido_externo` (1868) | `canal`, `externalId`, `clientRef`, `status('novo'..)`, `statusPagamento`, `pago` | fila de pedidos externos (delivery/totem-como-canal) |
| `movimento_estoque` (~1783) | `tipo(entrada|saida|ajuste)`, `refTipo`, `refId`, `itemId`, `custoUnitario` | ledger; saldo = soma; idempotente por `idx_movimento_ref` |
| `ficha_tecnica` (1033) / `ficha_ingrediente` (1058) | `rendimento`; `itemId`\|`subFichaId`, `quantidade`, `fatorCorrecao` | produto→ficha→insumo (recursivo) |
| `item_estoque` | insumo real; saldo derivado do ledger | único nível com saldo consultável |
| `caixa_sessao` (872) / `lancamento_caixa` (851) | sessão: `terminalId`, `origem`, `*PorForma`; lançamento: `forma`, `sessaoId`, `comandaId` | fechamento cego por forma; externo entra sem sessão |
| `nota_fiscal` (1810) | `chave`, `qrcode`, `protocolo`, `serie`, `numero`, `xml`, `status`, `ambiente` | tudo p/ DANFE; transmissão real = stub |
| `pagamento_tef` (2053) | `status`, `nsu`, `autorizacao`, `bandeira`, `provedor` | separado do caixa; resolvido pelo agente de edge |
| `equipamento` (724, token unique 752) | `token` (sync), `tipo('servidor_local'|'pdv'|…)`, `segredoHash`, `unidadeId`, `ativo` | base da auth de dispositivo (`X-Sync-Token`) |
| `cardapio_config` | `token` (12 hex), `ativo` | menu público `/publico/cardapio/:token` |

---

## 9. Plano de mudanças mínimas no Regem

> LACUNAS convertidas em tarefas. **Prioridade absoluta do piloto = L-VEN-1** (venda de totem paga por `codigo_pdv`). O restante é encadeável depois.

| # | Tarefa | Arquivos a tocar | Tamanho | Bloqueia piloto? |
|---|---|---|---|---|
| **L-VEN-1** | **Endpoint de venda de totem paga.** `POST /api/v1/vendas/externa-pdv` (`SyncTokenGuard`). Body: `{ idempotencyKey, cpf?, itens:[{codigoPdv, quantidade, complementos?[], observacao?}], pagamentos:[{forma, valor, nsu?, autorizacao?}], taxaServicoPct?, origemTerminalId }`. Resolve produto por `(tenant, codigoPdv)` (reusa `porCodigo`), materializa via `venderExterno`, marca `pago:true`, dispara estoque + fiscal imediatos. Retorna `{ comandaId, senha, total, nfce? }`. | `modules/vendas/vendas.service.ts` (novo `venderTotem` sobre `venderExterno`), `modules/vendas/vendas.controller.ts` (ou novo `vendas-externa.controller.ts`), novo `dto/venda-totem.dto.ts`, `modules/delivery/adapters.ts` (reuso do de-para por código) | **M** | **SIM** |
| **L-VEN-CPF** | Adicionar **`cpf`** opcional ao caminho de venda (coluna em `comanda` + repasse à nota fiscal). | `db/schema.ts` (`comanda.cpf`), migration `NNN_comanda_cpf.sql`, `vendas.service.ts`, `fiscal.service.ts` (destinatário) | **P** | SIM (se totem emite NFC-e com CPF) |
| **L-CAT-2** | **Leitura de catálogo por dispositivo.** Aceitar `X-Sync-Token` em `GET /produtos` (+ `/:id`, `/categorias`) ou criar `GET /api/v1/sync/catalogo` que devolve produtos **com `codigo`** e opções **com `codigoPdv`** para o import inicial do GoGeM. | `modules/produto/produto.controller.ts` (guard alternativo) **ou** `modules/sync/*` (novo endpoint), `sync-token.guard.ts` | **M** | SIM (import inicial) |
| **L-EST-1** | **Disponibilidade por produto.** `GET /api/v1/produtos/:id/disponibilidade` (ou lote) devolvendo `esgotado`/`disponivel` reusando `computeEsgotados`. | `modules/produto/produto.controller.ts` + `produto.service.ts` (expor `computeEsgotados`), ou reuso do campo `esgotado` do menu | **P** | Não (menu público já traz `esgotado`) |
| **L-CX-1** | **Totem no fechamento de caixa.** Decisão (a) parear totem como terminal `pdv` (zero código) **ou** (b) adicionar dimensão `origem/canal` em `lancamento_caixa` para discriminar totem no fechamento. | (b): `db/schema.ts` (`lancamento_caixa.canal`), migration, `financeiro.service.ts` (`fecharSessao` agrupa), `vendas.service.ts` | P (a) / M (b) | Não (definir na config do piloto) |
| **L-AUTH-1** | **Auth M2M própria (pós-piloto).** Client-credentials com escopos (`catalog:read`, `sale:write`) para o GoGeM como app terceiro, em vez de reusar sync token de dispositivo. | novo `modules/oauth/*` ou guard de API-key, `auth/*` | **G** | Não (piloto usa `X-Sync-Token`) |
| **L-EVT-1** | **Webhooks de saída (pós-piloto).** Registro de webhook + emissão de `order.registered`/`stock.low`/`cashclosing.done` a partir do event-emitter interno. Alternativa barata p/ piloto: GoGeM assina o **Socket.IO** com sync token. | `modules/realtime/*`, novo `modules/webhooks/*`, `app.module.ts` | **M/G** | Não |
| **L-FIS-1** | **Transmissão real SEFAZ** (`SefazDireto`): cert A1, XML-DSig, SOAP, por UF, contingência. | `modules/fiscal/transmitter.ts`, `nfce-xml.builder.ts`, `fiscal.service.ts` | **G** | Não (totem em "modo sem fiscal" ou "fiscal no integrado" no piloto) |
| **L-SEC-1** | Endurecer webhooks de entrada: assinatura no 99food; não cair para loja única no Cardápio Web sem token. | `modules/integracoes/food99/*`, `.../cardapio-web/*` | **P** | Não |

**Encadeamento imediato (conforme o plano GoGeM):**
1. Criar o monorepo GoGeM com o `CLAUDE.md`; copiar este arquivo para `integrations/regem/ENDPOINTS.md`.
2. Na S1, desenhar `products.external_refs[] = {sistema:'regem', codigo_pdv}` sobre o `produto.codigo` mapeado aqui (chave `(tenant, codigo)`).
3. Implementar **L-VEN-1** primeiro (é a única indispensável ao piloto). Para o import, **L-CAT-2**.

---

### Anexo — legenda de confiança
Todos os endpoints e campos acima foram confirmados abrindo o handler/serviço/DTO/schema reais no commit `65a98de` (método, path e campos conferidos). Payloads foram copiados dos DTOs/serializers; nenhum foi inventado. Onde a capacidade não existe no código, está explícito como `LACUNA`/`AUSENTE`.
