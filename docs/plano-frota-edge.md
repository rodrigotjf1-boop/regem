# Plano — Gestão de Frota Edge (saúde · impressão por unidade · controle de instalação)

> **Status:** PROPOSTO (plano antes do código). Nasceu da sessão de 31/08/2026 (firefight do potitjf) + 3 investigações de código só-leitura. Aguarda aprovação por fase. Fonte da verdade das decisões = `docs/decisoes-design.md` §6 (registrar ao aprovar).

## 0. O achado unificador (por que é UM programa, não 3 features soltas)

As três ideias levantadas — **saúde da frota**, **impressão desacoplada roteada por loja**, **controle de instalação anti-clone** — batem no **mesmo buraco**:

> O **dado** já é escopado por `unidade_id` em todo lugar (`pedido_externo`, `comanda`, `producao_pedido`, `impressao_job`, `equipamento`). Mas os **roteadores/consumidores/monitores** (heartbeat, `deferirParaEdge`, `EdgePedidosProcessor`, `jobsPendentes`, `SyncTokenGuard`) decidem por **`tenant_id`**, ignorando `unidade_id` e o **fingerprint** do device.

Consequências reais confirmadas no código:
- **Saúde:** `/frota` mostra 🟢 online só porque chegou heartbeat do `RegemEdgeSync` — **nenhuma checagem dos 5 serviços**; se o Postgres ou a Impressão caírem, continua verde. E `edge_heartbeat` **não tem `unidade_id`** → matriz+filial se misturam.
- **Impressão:** com 2 lojas no mesmo tenant, **o edge da matriz pode capturar e imprimir o pedido da filial** (a LAN **não** isola — o fallback "primeira impressora disponível" + impressoras `unidade_id NULL` são a porta dos fundos).
- **Instalação:** o self-service exige **só a senha do C&O** e **regrava o fingerprint pro clone incondicionalmente** (`licenca.service.ts:284-327`) → senha vazada = edge clone legítimo.

**Logo a fundação (F1) é uma só:** enriquecer o heartbeat com **saúde real + `unidade_id` + fingerprint**. F2 (impressão) e F3 (instalação) plugam nela.

---

## 1. Estado atual (mapa da investigação — arquivos-âncora)

**Saúde/heartbeat:** `backend/edge/sync-daemon.mjs` `heartbeat()` L471-485 → `POST /edge/heartbeat` (`x-sync-token`), payload `{versao, estado, ultimoSync, clientes, erro}`, best-effort, 60s. Nuvem: `licenca.service.ts heartbeat()` L374-391 → INSERT append-only `edge_heartbeat` (schema L2365-2376; **aceita `disco_livre_mb` mas o daemon nunca envia**). Online = recência de `recebido_em` (**UIs 5 min**, `common/edge-ativo.ts` **3 min** — duas janelas divergentes). Console: `frota/page.tsx` (via `/revenda/frota`, **N+1**), `distribuicao/page.tsx` (via `/distribuicao/frota`, **set-based LATERAL** — bom). **Nenhuma checagem de serviço Windows existe.**

**Identidade/segurança:** duas identidades — **token** (`equipamento.token`, `servidor_local`; `SyncTokenGuard` só checa token+`ativo`, **ignora fingerprint e tenant**) e **fingerprint** (sha256 do MachineGuid; conferido **só em `/edge/lease`**; graça 30d). Lease Ed25519 (`licenca/lease.ts`). Revogação: bloquear empresa / `mudarStatus(revogado)` / `revogar()` (token→401) / `rebind`/`trocarMaquina`. Provisionamento: `instalarSelfService` L173-328 (auth C&O bcrypt; **reativa device revogado** L261-274; **rebind incondicional do fingerprint** L284-327). Reutilizáveis: `common/mailer.ts enviarCodigoVerificacao`, `distribuicao/totp.ts verificarTotp`, tabela padrão `cadastro_pendente`.

**Multi-unidade/impressão:** `unidade` (schema L60, `tipo matriz|filial`). Edge sabe sua unidade (`EDGE_UNIDADE_ID` no `.env.local` + `ctx.unidadeId` do `SyncTokenGuard` L35) **mas não usa**. `impressao_job` **NÃO está em `TABELAS_SYNC`** (já é canal à parte). `print-agent.mjs` já puxa `GET /impressao/pendentes` + **ACK** (`/impressao/:id/impresso|erro`) — ponte nuvem→máquina pronta, mas **escopada por tenant**. `jobsPendentes(tenantId)` e o daemon local `impressao-daemon.mjs` (LISTEN `impressao_nova` + poll 3s, TCP 9100 / winspool) **não filtram unidade**. A **seleção de impressora** já respeita `unidade_id OR NULL` (`enfileirarViaCliente`), mas o **consumo** não. Já há planejamento: `docs/roadmap-impressao-kds.md` gap#9 + Fase 10.

---

## 2. Erros já registrados a NÃO repetir (checklist transversal)

Da memória do projeto — aplicar em toda fase:
- **Timeout em todo shell-out/fetch/query** (o ciclo do daemon é serial; um `sc query`/`wmic` pendurado congela o sync — mesmo motivo do `fetchT`/pool pg). [[edge-sync-fetch-failed-ipv6]]
- **Observabilidade primeiro** (a caixa-preta do restore custou horas): todo processo novo loga progresso + causa real. [[edge-sync-fetch-failed-ipv6]]
- **Query set-based, 1 request** — nunca N+1 nem loop de N (não replicar o N+1 do `/revenda/frota`). [[operacoes-massa-1-request]]
- **`.ps1` sempre com BOM** (PS 5.1 lê sem BOM como ANSI e quebra). [[edge-encoding-ps1]]
- **Idempotência** em tudo que grava (print claim, re-auth, materialização). [[estorno-stacking-regras]]
- **Migration:** conferir o ÚLTIMO número em `origin/main` antes de criar; `@cloud-only` nas tabelas de nuvem; usuário aplica na nuvem, eu no local. [[migracoes-divisao-nuvem-local]]
- **Build/release** só via `build-release.ps1` de árvore no `origin/main` + preflight. [[release-edge-build-verificado]]
- **Fonte única** pra "edge online" (`edge-ativo.ts`), não janelas hardcoded divergentes.
- **RBAC no servidor** + sensível = distribuição (nunca no lado do usuário). [[modelo-distribuicao-acesso]]

---

## 3. Fases

### F1 — Fundação: heartbeat rico + por unidade + fingerprint

**Objetivo:** a nuvem enxergar a saúde real de cada edge **por loja**, sem pedir `Get-Service` a ninguém — e ter o fingerprint por unidade que F2/F3 consomem.

**Mudanças:**
1. **Schema/migration** (`@cloud-only`): `edge_heartbeat` ganha `unidade_id uuid null` + `fingerprint text null` + **`saude jsonb null`** (payload rico evolui sem migration a cada campo). Tipar em `schema.ts` (`edgeHeartbeat` L2365). Índice `(tenant_id, unidade_id, recebido_em desc)`.
2. **Daemon** (`sync-daemon.mjs heartbeat()`): enriquecer o payload **no heartbeat de FIM de ciclo** (o ping de liveness L614 continua mínimo/barato):
   - `unidadeId` (de `EDGE_UNIDADE_ID`), `fingerprint` (`fingerprintForte()`), `discoLivreMb`, `ramMb`, `uptime`, `restaurando`/`restoreProgresso` (já em `sync_state`), `impressoraConfigurada` (query local), `servicos` (5 serviços via `sc query` **com timeout** — helper novo `statusServicos()` espelhando a disciplina do `fetchT`).
3. **Nuvem** (`licenca.service.heartbeat`): gravar os campos novos; **unificar a janela de online** em `edge-ativo.ts` como fonte única, agora por `(tenant, unidade)`.
4. **Console:** `/frota` e `/distribuicao` mostram **badge por serviço** (Api/Web/Sync/Impressão/Pg up/down), versão, restore em andamento, disco, **por unidade**; alerta quando um serviço cai ou o restore trava. Trocar o N+1 do `/revenda/frota` por query set-based (LATERAL, como o `/distribuicao`).
5. **Retenção:** cron de expurgo do `edge_heartbeat` (append-only nunca podado hoje) OU "última linha por (tenant,unidade) via upsert + tabela de histórico separada".

**Opções de implementação (escolher):**
| Peça | A | B | Recomendação |
|---|---|---|---|
| Coleta de saúde | **Enriquecer o heartbeat existente** (menos partes, reusa auth) | Serviço/reporter dedicado (`RegemEdgeSaude`) | **A** — menos superfície, o heartbeat já é autenticado e periódico. Um serviço a mais é mais uma coisa pra cair. |
| Formato do status | **`saude jsonb`** (evolui sem migration) | N colunas tipadas | **A** — payload vai crescer; jsonb evita migration a cada campo (colunas só pro que a UI filtra/ordena muito). |
| Status dos serviços | `sc query` a cada heartbeat, **com timeout + cache 30s** | LISTEN de eventos do SCM | **A** — simples, robusto; cache evita custo no ping. |

**Testes:** spec do payload do heartbeat (campos + defaults); parsing do `sc query` (serviço up/down/ausente); query de frota set-based sem N+1; janela de online única por (tenant,unidade). **Manual:** derrubar `RegemEdgePg` e ver a frota marcar Pg 🔴 (hoje fica 🟢).

---

### F2 — Impressão independente + roteada por unidade (nunca matriz→filial)

**Objetivo:** o pedido da nuvem imprime **só no edge da unidade certa**, **verificado online**, por um canal que **não depende do sync/restore**; se a unidade não tem edge, a nuvem **segura + avisa** (nunca imprime na loja errada, nunca perde).

**Mudanças (todas "escopar por `unidade_id`"):**
1. **Heartbeat por unidade** (vem do F1) → trocar `deferirParaEdge` (`delivery.service.ts:322`), `edgeAtivo` (`edge-ativo.ts:11`) e `CloudFallbackProcessor` (`cloud-fallback.processor.ts:58`) para checar heartbeat por **(tenant, unidade)**.
2. **Canal dedicado por unidade:** `jobsPendentes(tenantId)` → `jobsPendentes(tenantId, unidadeId)` com `AND (impressao_job.unidade_id = $u OR unidade_id IS NULL)`; passar `ctx.unidadeId` no `impressao.controller.ts` (já disponível no guard). `GET /impressao/pendentes` vira **o canal de impressão por unidade**, já fora do sync.
3. **Materializador do edge** (`EdgePedidosProcessor:41-49`): `AND pedido_externo.unidade_id = EDGE_UNIDADE_ID` — o edge só materializa/imprime o que é da sua loja.
4. **Daemon local** (`impressao-daemon.mjs:165`): `where (unidade_id = $EDGE_UNIDADE_ID or unidade_id is null)` enquanto o banco local for tenant-wide.
5. **Claim/lease anti-duplo-print:** `impressao_job` ganha `status 'enviando'` + `claim_por (equipamento_id)` + `claim_ate`; a entrega do job faz `pendente → enviando(lease)`; ACK volta pra `impresso`/`erro`. (Hoje `jobsPendentes` não reserva → dois consumidores duplicam.)
6. **Fallback:** se a unidade não tem edge com heartbeat, a nuvem **segura em `pendente` + alerta o gestor** (`telemetria_evento`/notificação) OU entrega ao `print-agent.mjs` daquela unidade. Restringir o fallback "primeira impressora" à **unidade correta** (é a porta dos fundos do vazamento).

**Opções de implementação (escolher):**
| Peça | A | B | C | Recomendação |
|---|---|---|---|---|
| Transporte nuvem→edge | **HTTP pull** (`GET /impressao/pendentes` por unidade, LISTEN local + poll) | WebSocket push | SSE | **A** — reusa `print-agent`/`impressao-daemon` que já existem e o poll é robusto a rede intermitente. WS/SSE dão latência menor mas adicionam conexão persistente a manter (mais uma coisa a cair). |
| Origem do job | Materialização local escopada por `EDGE_UNIDADE_ID` (**menos mudança**) | Enfileirar na nuvem com `equipamento_id` destino e o edge só imprime | — | **Começar por A**, evoluir pra B onde a nuvem precisa rotear ativamente (marketplace direto). |

**Testes:** pedido da matriz **nunca** puxado/impresso pelo edge da filial (scoping); claim idempotente (2 pullers, 1 impressão); fallback quando a unidade está sem edge (segura + avisa, não imprime em outra); impressora `unidade_id NULL` restrita à unidade. **É a fase que fecha o risco matriz↔filial.**

---

### F3 — Controle de instalação (anti-clone: senha vazada não instala em outra máquina)

**Objetivo:** só **1 edge autorizado por unidade**; nova instalação em máquina diferente exige **2º fator** (código e-mail/TOTP) e **mata a antiga**; reinstalar na **mesma** máquina segue liso.

**Mudanças:**
1. **Fechar o rebind cego:** `instalarSelfService` (`licenca.service.ts:284-327`) hoje faz `set deviceFingerprint = fingerprint` incondicional. Trocar por: se já existe fingerprint bound pra a `(unidade)` e **difere** do recebido → **NÃO rebinda**; dispara re-autorização; só rebinda ao aprovar. (O anti-clone atual só barra cross-tenant.)
2. **Re-autorização (2º fator):** tabela `reautorizacao_edge` (análoga a `cadastro_pendente`: `codigoHash`, `expiraEm`, `tentativas`, `fingerprintNovo`, `unidadeId`) + endpoints `/provisionamento/reautorizar/solicitar` e `/confirmar` (fora do `LicenseInterceptor` — a lista de isenção já cobre `provisionamento`). Código via `mailer.enviarCodigoVerificacao`; **TOTP** via `totp.ts` se o C&O tiver 2FA.
3. **Matar a antiga DE VERDADE:** **rotacionar o `equipamento.token`** (não só divergir o lease — o `SyncTokenGuard` ignora fingerprint, então o lease só corta o app em 30d). Ao aprovar a nova máquina: gerar **novo token**, `revogadoEm`/`ativo=false` na credencial antiga → antiga cai em **401 imediato**; devolver o novo token no fluxo. **Condicionar a reativação** do `instalarSelfService` (L261-274) à re-auth aprovada (senão o "kill" é desfeito no próximo provisionamento com a senha vazada).
4. **Notifica + audita:** todo pedido de move → aviso à empresa ("nova instalação solicitada em [máquina] — foi você?") + trilha imutável (reusar `distribuicao_auditoria`).
5. **Defesa em profundidade (opcional):** `SyncTokenGuard` passa a checar `x-sync-fp` (hoje cego a fingerprint).

**Gotchas obrigatórios (senão trava cliente legítimo):**
- **Mesma máquina = mesmo MachineGuid** → `fingerprint recebido == bound` → **libera sem re-auth**.
- **MachineGuid pode mudar** (reinstalação de SO, clone de disco, VM) → o bloqueio é **soft** com escape hatch (código/TOTP), **nunca hard-block**.
- **Fingerprint fraco** (fallback `hostname()`) → tratar como "sempre exigir confirmação".
- **`-Limpar`/`-SemProteger`** desligam DPAPI+ACL → segredos em texto; a re-auth não deve depender de segredo em repouso nessas máquinas.

**Opções de implementação (escolher):**
| Peça | A | B | Recomendação |
|---|---|---|---|
| 2º fator | **Código por e-mail (OTP)** — baseline, todo mundo tem e-mail | **TOTP/authenticator** — mais forte | **B como opção forte, A como fallback.** Quem vazou a senha provavelmente não tem o authenticator; e-mail cobre quem não ativou 2FA. Oferecer os dois. |
| "Matar" | **Rotacionar token** (401 na hora) | Só divergir lease (30d) | **A** — B não mata o sync. |
| Onde bloquear | **No provisionamento** (`instalarSelfService`) | No heartbeat/lease | **A** — é onde o rebind acontece; bloquear antes de gravar. |

**Testes:** reinstalação na mesma máquina **não** pede re-auth; máquina diferente **bloqueia** e exige código; fluxo de re-auth (código válido → rebind + token novo); token antigo **401 após rotação**; reativação **gated** pela re-auth (senha vazada sozinha não reativa); fingerprint fraco sempre exige confirmação.

---

## 4. Segurança de distribuição (transversal — práticas)

- **Zero segredo no lado do usuário** (integração = usuário informa, Regem conclui). Sensível (token, fingerprint, lease, saúde cross-tenant) = **distribuição**. [[modelo-distribuicao-acesso]]
- **Identidade em 2 camadas endurecida:** token **rotacionável** + fingerprint **bound por unidade** + `SyncTokenGuard` opcionalmente conferindo fingerprint (defesa em profundidade).
- **2º fator no move** (TOTP > e-mail) — o ponto central do épico.
- **Trilha imutável** de todo move/revoke/re-auth (append-only, `distribuicao_auditoria`).
- **Rate-limit** já existe no `provisionamento` (8/min, 20/min) — manter e estender à re-auth.
- **Notificação proativa** de tentativa de move → alerta o dono de ataque em andamento.
- **Escopo por unidade** em roteamento/monitoramento fecha o vazamento cross-loja (é segurança de dados, não só UX).
- **DPAPI + ACL** nos segredos em repouso; corrigir/avisar o gap do `-Limpar` (segredo em texto).
- **Encadear nos controles existentes** (`revogar`, `rebind`, `trocarMaquina`, TOTP do console) — não criar caminho paralelo.

---

## 5. Ordem, dependências e entrega

```
F1 (fundação: heartbeat rico + unidade + fingerprint + saúde real)
      │  (heartbeat por unidade)        │ (fingerprint por unidade)
      ▼                                  ▼
F2 (impressão roteada por unidade)   F3 (controle de instalação anti-clone)
```
- **F1 primeiro** — destrava as outras duas e já entrega valor imediato (a dor desta sessão: ver a saúde sem pedir `Get-Service`).
- **F2 e F3** podem ir em paralelo depois de F1.
- **Migrations** (conferir o último nº em `origin/main` na hora, `@cloud-only`): F1 = `edge_heartbeat` + `unidade_id`/`fingerprint`/`saude`; F2 = colunas de claim em `impressao_job`; F3 = `reautorizacao_edge`. Todas idempotentes.
- **Corte de release** só via `build-release.ps1` + preflight, do `origin/main`. O `.exe` sai versionado; `.zip` pra mudança de backend/edge.

## 6. Fora de escopo / follow-ups
- Contagem real de `EDGE_CLIENTES` (hoje fixo 0 — bug latente da coluna "Clientes").
- Escopar o **sync pull** por unidade (mudança maior; por ora o scoping é no consumo/impressão).
- Retenção/expurgo global de `edge_heartbeat` e `telemetria_evento`.

---

## 7. Próximo passo
Aprovar **fase a fase**. Sugestão: **começar pela F1** (fundação + a saúde que a gente sentiu falta a sessão inteira). Ao aprovar, eu detalho a F1 em tarefas + migrations e implemento em dev-local (branch → PR → CI verde → merge), com os testes acima.
