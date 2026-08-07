# Roadmap — Organização da lógica de Impressões e KDS

> **Documento de planejamento (sem código).** Fonte: varredura tradicional (leitura de código) **cruzada** com o
> grafo `graphify` (`graphify-out/graph.json`) e o dump real do banco (`docs/db-estrutura.md`, 02/08/2026).
> Regras transversais aplicadas a TODAS as fases (ver §8). Trabalho em `dev-local`; migrations de **nuvem = usuário**,
> **teste/local = eu**. Nada é iniciado sem aprovação e priorização.

---

## 0. Método (as duas varreduras, cruzadas)

- **Tradicional (file:line):** deu a lógica precisa — `enfileirarViaCliente`, `resolverDestinos`, `criarPedidos`,
  `imprimirNaEtapa`, `avancar`, `perfilEfetivo`, `renderEscpos`, catálogo de permissões.
- **graphify:** confirmou o *wiring* dos serviços (hub = `ProducaoPedidoService`, ligado a Vendas/Equipamento/
  Produto/Cardápio/Delivery) e revelou um consumidor a mais: **`cardapio.service.receberPedido` (L1406)** também
  cria pedido → produção → impressão. Confirmou que `enfileirarViaCliente` é chamado **só** por `imprimirViaCliente`
  (funil único — bom para não deixar ponta solta).
- **Divergência de banco (crítica):** `cupom_perfis` e `cupom_layout` vivem em **`delivery_config`**, NÃO em
  `cardapio_config` (pegadinha do #260). Toda migration de cupom mira `delivery_config`.
- **Dump 02/08 NÃO tem `faz_cupom/faz_producao`** — a mig 167 ainda não subiu na nuvem (pré-requisito de várias fases).

---

## 1. Modelo conceitual (o que fica combinado)

- **Setor** = unidade lógica de roteamento. **KDS roteia por SETOR**; **impressora imprime** (convenção: dar à
  impressora o nome do setor). Áreas-base:
  - **Atendimento:** caixa PDV, sub-PDV salão, bar…
  - **Produção:** cozinha, chapa, fritadeira, produção1, montagem, despacho…
- **Duas vias por pedido** (balcão/salão **e** delivery):
  - **Via do cliente:** cabeçalho (empresa, operador, hora, ticket, senha) · corpo (itens) · **subrodapé**
    (financeiro: pagamentos, descontos, totais) · rodapé (msg/propaganda/QR: cupom fiscal, pesquisa, link).
  - **Via de produção:** cabeçalho (senha, hora, ticket) · corpo (itens) · rodapé (msg/campo personalizado).
  - **Nº de vias por setor/impressora = o usuário define.**
- **Quem roteia (por origem):**
  - **Servidor edge** roteia **todos os externos** (cardápio Regem, cardápio integrado, marketplaces, **totens**).
  - **PDVs** roteiam **seus lançamentos** (para setores/KDS/impressoras cadastradas).
  - **Totem (GoGeM)** cai no **caixa do servidor** (exige um PDV aberto no servidor p/ contabilidade), com opção de
    **não** reimprimir a via do cliente no PDV (o totem já imprime a dele).
- **Senha única:** PDVs puxam a ordem da senha do **servidor** para não duplicar entre PDV/delivery/totem.

---

## 2. Estado atual — JÁ EXISTE (do cruzamento)

| Área | Já existe |
|---|---|
| Perfis de cupom | 3 fixos (`caixa`, `entregador`, `producao`) em `delivery_config.cupom_perfis`; `perfilEfetivo(id,override)` funde padrão+loja (`delivery/cupom-perfis.ts`). |
| Editor de cupom | On/off por campo, **ordem**, **alinhamento**, **negrito**, cabeçalho/rodapé livres, prévia (`config-panel.tsx`). QR do entregador. |
| Tokens ESC/POS | `@C/@R/@B` (+combos), `@QR:`, legado `*** ***`/`>>> SENHA <<<`, transliteração ASCII, 58/80mm (`edge/escpos.mjs`). |
| Roteamento produção | `resolverDestinos` (produto → setor → impressora única) + `setores_atendidos` + `padrao`; filtra `faz_producao` (mig 167). |
| Roteamento cupom | `enfileirarViaCliente`: override → terminal (`impressora_padrao_id`) → `faz_cupom` da unidade → fallback válido + aviso (mig 167). |
| Destino por opção/complemento | Tabelas `opcao_destino_producao` / `complemento_destino_producao` + função `destinosDaOpcao` (mig 127). |
| KDS | `tipo='kds'`, `escopo`, `setor_id`; cadeia `proximo_kds_id` (mig 159); impressão na etapa `imprime_ao_avancar`+`imprime_no_status`+`impressora_destino_id` (mig 129). |
| Vias | `equipamento.vias` (replicado pelo worker). |
| Senha | `senha_contador` da unidade com `FOR UPDATE`; `cardapio_senha_seq` por canal. |
| RBAC | Catálogo configurável; chaves `producao_kds` e `servidor`; realm **separado** da distribuição (frota/licença/telemetria). |
| Nuvem×Edge | `EDGE_MODE`/`NEXT_PUBLIC_EDGE`, indicador de modo, detecção de edge por **heartbeat**; ponte `/impressao/pendentes` + `print-agent.mjs`. |

---

## 3. Lacunas — FALTA (o que o roadmap cobre)

1. **Ponta solta:** `destinosDaOpcao`/`complemento_destino_producao` existem mas **NÃO são chamados** em
   `criarPedidos` — direcionamento por opção/complemento está modelado e **não integrado**.
2. **Etiqueta de produto personalizado** (nº pedido + observação/complemento p/ colar no produto): não existe.
3. **Perfis de cupom** só 3; faltam: cliente, produção balcão, produção delivery, cliente totem, **sangria**,
   **suprimento**, **fechamento**, + **cupom personalizado** (puxando qualquer campo).
4. **Editor de cupom:** falta tamanho de fonte, linha em branco/tracejada, **agrupar 2 campos numa linha (esq/dir)**,
   desagrupar.
5. **KDS:** falta a opção explícita "produção imprime **só ao avançar** no KDS X da cadeia" vs imediato ao registrar.
6. **Origem/roteamento:** falta separar claramente config de **externos (servidor)** × **lançamentos (PDV)**;
   **Totem GoGeM** não integrado e não cai em `caixa_sessao`; `proximoNumero` **sem lock**; contadores de senha
   **não unificados** entre PDV/delivery/totem.
7. **RBAC fino:** não há chave dedicada p/ impressoras, KDS, direcionamento, layout de cupom (tudo em `producao_kds`).
8. **Técnico da distribuição:** não existe login cross-tenant na operação da loja (tenant preso no JWT).
9. **Nuvem→Edge:** ao imprimir/configurar pela nuvem, não há verificação em runtime "esta empresa tem edge" que
   redirecione para as configs/serviço locais.

---

## 4. Fases (detalhado — sem código)

> Cada fase lista: **objetivo · mudanças (back/front/migration) · ligações/dependências · RBAC & segurança ·
> UI/UX · teste (modo teste) + verificação de impacto em produção · risco.** Migrations conferidas contra
> `db-estrutura.md` para **não duplicar** coluna/tabela.

### Fase 1 — Fundação: integrar direcionamento por produto/opção/complemento (fecha a ponta solta)
- **Objetivo:** todo item roteia para o(s) destino(s) certo(s), inclusive quando o direcionamento está na **opção/
  complemento** (não só no produto/setor).
- **Back:** chamar `destinosDaOpcao`/`complemento_destino_producao` dentro de `criarPedidos` (hoje só usa
  `resolverDestinos`+`setores_atendidos`). Precedência: opção → complemento → produto → setor → padrão.
- **Migration:** nenhuma (tabelas já existem: `opcao_destino_producao`, `complemento_destino_producao`).
- **Ligações:** `criarPedidos` ← `venderExterno`/venda balcão (vendas) e `cardapio.receberPedido` (L1406); garantir
  que os **dois** caminhos passam pela mesma resolução.
- **RBAC/seg:** sem mudança de superfície; manter tenant forçado.
- **UI/UX:** a tela `/direcionamento` já direciona produto→destino; expor destino por opção/complemento (já há
  `setOpcaoDestinos`/`setComplementoDestinos`) num ponto visível.
- **Teste:** pedido com complemento direcionado sai na impressora do complemento; sem direcionamento, herda produto.
- **Risco:** baixo (fecha buraco existente).

### Fase 2 — Vias por tipo (cliente/produção) e por setor
- **Objetivo:** nº de vias configurável separadamente para **cliente** e **produção** por impressora/setor.
- **Migration (verificar):** `equipamento.vias` já existe (única). Avaliar `vias_cliente` / `vias_producao`
  (NÃO existem no dump → aditivas) **ou** manter `vias` global + multiplicador por via no roteamento. Decisão de
  design a confirmar (ver §9).
- **Front:** no cadastro de impressora, campos de vias por tipo.
- **Teste:** 2 vias de produção + 1 de cliente saem conforme configurado.
- **Risco:** baixo.

### Fase 3 — Perfis de cupom completos (7 + personalizado)
- **Objetivo:** perfis `cupom_cliente`, `producao_balcao`, `producao_delivery`, `cliente_totem`, `sangria`,
  `suprimento`, `fechamento` + **custom** (puxa qualquer campo dos padrões).
- **Back:** expandir `cupom-perfis.ts` (hoje 3) para o conjunto acima; `perfilEfetivo` já suporta override por id;
  render de sangria/suprimento/fechamento ligado aos eventos de caixa (`caixa_sessao`).
- **Migration:** **nenhuma coluna nova** — estende o jsonb `delivery_config.cupom_perfis` (perfis + lista custom).
  ⚠️ mirar **`delivery_config`** (não `cardapio_config`).
- **Ligações:** sangria/suprimento/fechamento ↔ módulo caixa; totem ↔ Fase 6 (origem totem).
- **RBAC/seg:** editar perfis exige a nova chave `cupom_layout` (Fase 7); valores financeiros seguem regra
  presidente/C&O (não vazar em perfil de produção).
- **UI/UX:** seletor de perfil com abas; criar/duplicar perfil custom.
- **Teste:** cada perfil renderiza os campos certos; produção **nunca** mostra financeiro.
- **Risco:** médio (abrangência).

### Fase 4 — Editor de cupom avançado (layout rico)
- **Objetivo:** tamanho de fonte, linha em branco, linha tracejada, **agrupar 2 campos numa linha (esq/dir)**,
  desagrupar.
- **Back (`escpos.mjs`):** novos tokens — `@F1/@F2/@F3` (GS ! tamanho), `@BR` (linha em branco), `@HR` (tracejada),
  `@LR<esq>|<dir>` (duas colunas: esquerda + direita alinhada). `renderCupomPerfil` emite conforme o layout.
- **Migration:** nenhuma (estrutura do campo no jsonb do perfil).
- **Front:** editor com esses controles + prévia monoespaçada fiel (32/48 col).
- **Teste:** prévia = saída térmica; agrupar/desagrupar preserva ordem.
- **Risco:** médio (render).

### Fase 5 — Etiqueta de produto personalizado
- **Objetivo:** quando um item tem complemento/observação marcada para etiqueta, sai uma **etiqueta extra**
  (nº pedido + item + obs/complemento) na impressora do complemento, para colar no produto.
- **Back:** nova `via='etiqueta_item'`; gerar no `criarPedidos` quando o item tiver complemento/obs com flag.
- **Migration (verificar):** flag `imprime_etiqueta` no complemento/etapa (**confirmar a tabela exata** —
  `complemento`/etapa — antes do ALTER; não existe no dump). Aditiva.
- **Ligações:** usa o direcionamento da Fase 1 (destino do complemento).
- **Teste:** item com complemento marcado gera etiqueta; sem, não gera.
- **Risco:** médio.

### Fase 6 — KDS: direcionamento + impressão na cadeia
- **Objetivo:** produção imprime **imediato ao registrar** OU **só ao avançar** numa etapa/KDS da cadeia (definido no
  KDS anterior que "arma" a impressão). Já há `proximo_kds_id`+`imprime_ao_avancar`+`imprime_no_status`.
- **Back:** flag no fluxo p/ **adiar** a via de produção até a etapa (hoje `imprimirNaEtapa` já imprime ao avançar;
  falta a opção de **não** imprimir no registro quando há KDS armado).
- **Migration (verificar):** possível `adia_producao_ate_kds` (boolean) no KDS/unidade (não existe no dump). Aditiva.
- **Front:** no cadastro do KDS, direcionamento (setores atendidos, próximo KDS, imprime nesta etapa, adia).
- **Teste:** cadeia montagem→despacho; via só sai ao avançar no despacho.
- **Risco:** médio.

### Fase 7 — Origem/roteamento por local + Totem GoGeM + senha unificada
- **Objetivo:** separar config de **externos (servidor)** × **lançamentos (PDV)**; integrar **totem** no caixa do
  servidor; **não duplicar senha**.
- **Back:** ponto de venda-PDV para totem (cai em `caixa_sessao` do servidor); opção de suprimir via do cliente no
  PDV p/ totem; **lock** no `proximoNumero`; coordenar `senha_contador`×`cardapio_senha_seq` (sequência única
  lógica por unidade).
- **Migration (verificar):** provável coluna de origem/flag no fluxo de venda; confirmar `producao_pedido`
  (já tem `plataforma`, `senha_plataforma`) e `caixa_sessao` (já tem `terminal_id`) antes de qualquer ALTER.
- **Ligações:** GoGeM (docs `integracao-gogem/ENDPOINTS.md`, lacuna L-VEN-1); `cardapio.receberPedido`; delivery
  `ingest`.
- **RBAC/seg:** totem autentica por `X-Sync-Token` de dispositivo (não JWT de usuário).
- **Teste:** pedido de totem entra no caixa do servidor, gera senha sem colidir com PDV/delivery.
- **Risco:** alto (concorrência de senha, caixa).

### Fase 8 — RBAC fino de configuração
- **Objetivo:** chaves dedicadas: `impressoras`, `kds`, `direcionamento_impressao`, `cupom_layout` (hoje tudo em
  `producao_kds`/`servidor`).
- **Back:** adicionar ao `CATALOGO_PERMISSOES` (`auth/permissoes.ts`) + `@RequirePerm` nos controllers; defaults por
  nível; presidente sempre passa.
- **Migration:** nenhuma (permissões vivem no `perfil_acesso` jsonb; só código + defaults).
- **Front:** pendurar as chaves no menu (shell) e ocultar telas sem permissão (RBAC no servidor continua a fonte).
- **Teste:** gerente sem `cupom_layout` não abre o editor (servidor recusa, não só o front).
- **Risco:** baixo/médio (não quebrar quem já usava `producao_kds`).

### Fase 9 — Técnico da distribuição (suporte cross-tenant)
- **Objetivo:** perfil **técnico** que loga em qualquer loja para configurar impressão/roteamento sem usar o
  presidente/C&O da loja.
- **Back:** estender o **realm da distribuição** (já separado — `DistribuicaoGuard`) com impersonation **escopada**
  (só config/impressão), **auditoria imutável** de toda ação, e emissão de token de acesso à loja X com expiração.
- **Migration (verificar):** tabela de sessão/consentimento de suporte (não existe). Aditiva.
- **Ligações:** amarrar ao épico **Console da distribuição** (`docs/console-distribuicao.md`).
- **RBAC/seg:** **alto risco** — impersonation cross-tenant. Regras: escopo mínimo, auditoria, expiração, sem acesso
  a financeiro/dados sensíveis além do necessário.
- **Teste:** técnico configura impressora na loja X; auditoria registra ator=distribuição.
- **Risco:** alto (segurança).

### Fase 10 — Nuvem → Edge (delegação de impressão/config)
- **Objetivo:** ao imprimir/configurar pela **nuvem**, detectar se a empresa tem **edge ativo** (heartbeat) e usar
  as **configs locais**/rotear pro edge; definir o edge como **fonte da verdade** de impressão quando presente.
- **Back:** checagem em runtime (heartbeat recente) antes de gerar job/config; sincronizar config de
  impressora/roteamento nuvem↔edge (direcional).
- **Migration:** provável none (usa `edge_heartbeat` existente).
- **Ligações:** `cloud-fallback.processor.ts`, `print-agent.mjs`, modo híbrido (`modo-hibrido-nuvem-local`).
- **Teste:** com edge online, impressão pela nuvem vai pro edge; sem edge, cai no print-agent.
- **Risco:** alto (consistência de config nuvem×edge).

---

## 5. Migrations previstas (conferidas contra `db-estrutura.md` — sem duplicar)

| # | Alvo | Coluna/tabela | Existe hoje? | Fase |
|---|---|---|---|---|
| 167 | `equipamento` | `faz_cupom`, `faz_producao` | ✅ criada (falta **nuvem**) | (feito) |
| novo | `equipamento` | `vias_cliente`, `vias_producao` *(se aprovado)* | ❌ | 2 |
| — | `delivery_config.cupom_perfis` (jsonb) | estende estrutura (perfis+custom) | coluna ✅ (mirar delivery_config) | 3 |
| novo | complemento/etapa | `imprime_etiqueta` (bool) — **confirmar tabela** | ❌ | 5 |
| novo | KDS (`equipamento`) | `adia_producao_ate_kds` (bool) | ❌ | 6 |
| novo | venda/caixa | flag origem totem / lock senha — **confirmar** `producao_pedido`/`caixa_sessao` | parcial | 7 |
| — | RBAC | novas chaves em `perfil_acesso` (jsonb) — **sem migration** | — | 8 |
| novo | suporte | tabela de sessão de suporte cross-tenant | ❌ | 9 |

> Regra: **antes de cada ALTER**, reconferir o `pgTable('<tabela>')` no `schema.ts` e a tabela real no
> `db-estrutura.md` (memória `migration-pooler-column-gotcha`). Migrations **aditivas e idempotentes**.

---

## 6. Ligações / pontas soltas (a fechar, com procedimento)

- ⚠️ **destino por opção/complemento não chamado** em `criarPedidos` → **Fase 1**.
- ⚠️ **`proximoNumero` sem lock** (corrida sob concorrência) → **Fase 7**.
- ⚠️ **Contadores de senha não unificados** (`senha_contador` × `cardapio_senha_seq`) → **Fase 7**.
- ⚠️ **Totem não cai em `caixa_sessao`** (`sessaoId=null`) → **Fase 7**.
- ℹ️ **`cardapio.receberPedido` (L1406)** é 2º consumidor da via/produção → cada fase valida **os dois** caminhos
  (venda balcão/externo **e** cardápio web).
- ℹ️ **`cupom_perfis`/`cupom_layout` em `delivery_config`** → toda mudança de cupom mira essa tabela.
- ℹ️ **Multiplicação de `vias`** ocorre no **worker** (edge), não na geração do job → considerar na Fase 2.

---

## 7. Ordem recomendada e dependências

```
1 (integra destinos) ─┬─> 5 (etiqueta usa destino do complemento)
                      └─> 6 (KDS na cadeia)
2 (vias por tipo) ────────> 3 (perfis) ──> 4 (editor rico)
7 (origem/totem/senha) — independente, alto risco (fazer com calma)
8 (RBAC fino) — antes de expor telas novas de config
9 (técnico cross-tenant) — depende de 8; amarrar ao Console da distribuição
10 (nuvem→edge) — por último; depende de config estável (1–8)
```

**Sugestão de largada:** 1 → 3 → 4 (fecham a ponta solta e entregam o cupom rico visível), depois 2/5/6, e por fim
7/8/9/10 (os de maior risco/segurança).

---

## 8. Protocolo por fase (regras transversais, obrigatórias)

1. **Verificar o banco antes de qualquer migration** (`db-estrutura.md` + `schema.ts`) — não duplicar coluna/tabela;
   migration **aditiva e idempotente** (`add column if not exists`).
2. **RBAC no servidor** (não só no front); **tenant sempre forçado**; valores financeiros só presidente/C&O; totem/
   agentes autenticam por token de serviço, nunca JWT de usuário.
3. **UI/UX:** telas **responsivas por padrão** (grid com breakpoint, tabela em `overflow-x-auto`, flex-wrap),
   intuitivas, com estados vazios, feedback (toast) e acessibilidade (`aria-*`, foco).
4. **Ao FIM de cada fase:** testar a funcionalidade em **modo teste** (dev-local, banco `regem_local`, build
   back+front verde) **e verificar se há alteração/impacto em modo produção** (rota, contrato, dados) — registrando o
   que muda para a nuvem.
5. **Migrations:** eu aplico as de **teste/local**; as de **nuvem** ficam para o usuário. Sem PR por mudança —
   **uma PR só sob comando**.
6. **Sem pontas soltas:** cada alteração revalida os **dois** caminhos de entrada (venda balcão/externo e
   `cardapio.receberPedido`) e os consumidores no grafo.

---

## 9. Decisões TOMADAS (travadas)

1. **Ponto de partida:** **1 → 3 → 4** (fecha a ponta solta do direcionamento e entrega o cupom rico visível).
2. **Vias (Fase 2):** **separadas** — `vias_cliente` e `vias_producao` por impressora (migration aditiva).
3. **Cupom personalizado (Fase 3/4):** **lista de campos selecionáveis + opções de layout** (fonte, linhas,
   agrupar esq/dir); builder arrastar/soltar fica para evolução futura.
4. **Técnico cross-tenant (Fase 9):** construir **junto do Console da distribuição** (mesmo realm separado
   `DistribuicaoGuard`, impersonação escopada + auditoria).
