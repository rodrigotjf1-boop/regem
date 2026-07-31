# Roadmap — Segurança + Migração para App Nativo (Servidor/Cliente, local-first)

> **Status:** planejamento aprovado (jul/2026). Fonte da verdade para iniciar as mudanças.
> Complementa `docs/seguranca-edge.md` (proteção do edge — Fase 1 já feita).
> Regra de ouro: **tudo que roda no cliente é comprometível — a fronteira de segurança é a NUVEM.**

## 1. Objetivo

Migrar do modelo atual (backend na nuvem + edge opcional) para um **app nativo (Electron) em topologia Servidor/Cliente, local-first**, sem expor a lógica funcional nem a base de dados, com backup/DR, atualização segura, antifraude e licenciamento anti-burla.

## 2. Achados do grafo (varredura `backend/src`, graphify — 3754 nós, 10882 arestas, 139 comunidades)

**God nodes (hubs = onde o risco se concentra):**
- `DrizzleDB` — **770 arestas** (betweenness 0.44): o acesso ao banco conecta ~130 das 139 comunidades. **Tudo passa pelo DB.**
- `AuthUser` / `CurrentUser` — 522 / 485: contexto de auth atravessa quase todo endpoint (RBAC pervasivo, mas raio-de-explosão enorme se houver falha).
- `JwtAuthGuard` / `RolesGuard` / `Roles()` / `UnidadeAtual` — camada de enforcement (RBAC + multi-tenant).
- `DeliveryService` / `CardapioService` — serviços de lógica mais gordos (integrações + cardápio; onde vivem segredos e regras).
- `common/validadores-br.ts`, `common/regras-negocio.ts` — regras de negócio (CNPJ, telefone, jornada/ponto) reusadas por DTOs/serviços = **lógica funcional concentrada em `common/`**.

**Implicação central:** hoje toda a lógica + DB vivem no backend (nuvem, confiável). "Rodar o backend no edge" **empurra o sistema inteiro** (schema, adapters de integração, regras) pra máquina do cliente via `DrizzleDB` (770) → **é o vazamento a evitar**. **Decisão-mãe: NÃO enviar o backend inteiro pro edge — cortar um _edge-core_ mínimo.**

Saídas do grafo: `graphify-out/graph.html`, `GRAPH_REPORT.md`, `graph.json`.

## 3. Arquitetura alvo

### 3.1 Topologia Servidor/Cliente (1 instalador)
- **Um instalador**; no setup escolhe **Servidor** ou **Cliente**, além dos passos que já existem.
  - **Servidor (full):** onboarding completo (e-mail+senha da empresa, CNPJ, ativação de licença) + edge-core + Postgres + sync + workers de impressão. O "cérebro". 1 por loja/unidade (máquina confiável, de preferência com UPS).
  - **Cliente (magro):** **não repete** o cadastro — só **pareia com o Servidor** (mDNS/IP + token/QR) e recebe o **perfil**.
- **Perfil ≠ instalação.** PDV / KDS / sub-PDV / delivery / balcão+delivery / só-balcão / só-delivery são **filtro de UI + permissão** — a **mesma casca magra** com perfil diferente. Ideal: perfil atribuído **por configuração** (a estação pareia e recebe o papel), trocável sem reinstalar.
- **Modo combinado** (Servidor+PDV na mesma máquina) para loja de 1 PC.

### 3.2 Modo único local-first (sem confundir o usuário)
- O app do operador **sempre fala com o edge-core local** (localhost/LAN). Rápido, **nunca para**, não "sente" a internet.
- A nuvem é **parceiro invisível de sync** (empurra operacional pra cima; puxa controle pra baixo) + **porta remota separada** (dono acessa de casa pela web na nuvem, num navegador).
- **Sem toggle de modo.** No máximo um **status dot**: *sincronizado / sincronizando / offline*.

### 3.3 Comportamento offline + internet-reserva
- **Só o Servidor precisa de internet.** Clientes (PDV/KDS) usam **só a LAN**.
- Internet cai → **perde só o que depende da nuvem** (integrações automáticas de delivery, sync, remoto, telemetria — tudo **enfileira**). **Balcão/PDV/KDS/mesas/delivery-manual seguem 100%.**
- **Internet-reserva no Servidor** (4G/hotspot) restaura as integrações sem nenhum cliente precisar de internet; o Servidor recebe os pedidos e **distribui pela LAN conforme a config local** (setor/destino). Dá pra deixar o 4G como **failover automático**.
- O **Servidor é a autoridade de hora** (estações sincronizam) — importante p/ antifraude/ponto.

## 4. Segurança (por domínio · P0 crítico / P1 / P2)

### 4.1 Dados (repouso + trânsito)
- **P0** TLS 1.2+ em tudo (nuvem HTTPS + HSTS; edge com cert local, LAN cifrada).
- **P1** Cripto em repouso: BitLocker no volume do edge + coluna sensível (PII/custo) com chave **DPAPI**.
- **P1** Minimizar PII no edge + retenção/expurgo.
- **P2** Backups locais cifrados (AES-GCM/DPAPI).

### 4.2 Segredos & proteção do projeto (Electron + fonte)
- **P0** Segredos de terceiros (`EVOLUTION_API_KEY`, `N8N_BOT_WEBHOOK`, `BOT_RESOLVER_SECRET`, chaves de integração) **só na nuvem**; edge recebe **token de serviço de escopo mínimo, rotacionável/revogável**.
- **P0** Electron hardening: `contextIsolation:true`, `nodeIntegration:false`, `sandbox:true`, sem `remote`, DevTools off em prod, `webSecurity` on, **CSP estrita**, bloquear navegação externa.
- **P1** Strip/minify/ofuscar o edge-core; **Authenticode** no `.exe`; **DPAPI** p/ segredos locais (já existe `proteger-env`/`decrypt-dpapi`).
- **P2** Integridade do `.asar` (hash no boot contra valor assinado).

### 4.3 Antifraude (POS)
- **P0** Nuvem **não confia em totais** do edge — sobe **evento** (não agregado) com **ID idempotente + assinatura HMAC** (chave por-dispositivo) e **sequência monotônica**; gaps = registros omitidos → alerta.
- **P0** Auditoria/logs **append-only com hash-chain** (cada registro encadeia o hash do anterior) → adulteração/remoção detectável.
- **P0** Timestamp carimbado **no recebimento (nuvem)**; **anti-rollback de relógio** (guardar maior timestamp assinado); NSR/ponto = sequência assinada validada por monotonicidade.
- **P1** Nuvem **recomputa** caixa/CMV/estoque a partir dos eventos.
- **P1** Detecção de anomalias na telemetria (cancelamentos, gaps, dispositivo mudo, relógio fora).

### 4.4 Criptografia
- **P0** Senhas **bcrypt/argon2** (dist já usa bcrypt) + PIN com hash e rate-limit.
- **P0** Assinatura dos payloads de sync (HMAC-SHA256 por-dispositivo, chave via DPAPI) — ou mTLS.
- **P1** Rotação/revogação de tokens e chaves de dispositivo.
- **P2** Licença e updates assinados com chave assimétrica (Ed25519/RSA) — privada só na distribuição, pública embutida valida.

### 4.5 Estrutura atualizável (supply chain)
- **P0** Updates **assinados** (hash **+** assinatura verificada com pública embutida — hoje só há SHA-256); HTTPS com pin; verificar antes de aplicar.
- **P1** Anti-downgrade (recusar versão < atual, min-version assinada).
- **P1** Rollback verificado (já existe `reverter.ps1`); **P2** rollout escalonado (canary %) pela distribuição.
- **P1** **Handshake de versão** cliente↔servidor (recusa incompatível).

### 4.6 Logs + telemetria da distribuição
- **P0** Trilha crítica com hash-chain → sincroniza com a telemetria (canal já existe).
- **P0** Redação de PII/segredos no logger (sem token/CPF/cartão).
- **P1** Fila de logs offline persistente idempotente + assinatura do envio.
- **P2** Alertas na distribuição (anomalia, dispositivo mudo, 5xx — já tem 5xx).

### 4.7 Licenciamento (anti-burla)
- **P0** Licença = **lease assinado curto** (24–72h), validado local com pública embutida → renova online (mata "offline pra sempre", com janela de graça) + **fingerprint de máquina** amarrado (já há CNPJ+fingerprint no conceito).
- **P0** **Anti-rollback de relógio**.
- **P1** **Revogação central** (distribuição corta dispositivo/tenant — já existe `revogarLicenca`).
- **P1** **Valor amarrado à nuvem** — sync/delivery/telemetria morrem sem licença → **clone inerte**.
- **P2** Múltiplos pontos de verificação + ofuscação (defense in depth).

## 5. Backup & Disaster Recovery

### 5.1 O que já existe
- **Sync** (`sync-daemon.mjs`): PUSH do operacional (append-only) + PULL do controle → backup off-site **parcial** na nuvem.
- **Backup no update** (`atualizar.ps1`): blue-green + `pg_dump` (`backup-<data>/db.dump`) + rollback (`reverter.ps1`). **Só na hora do update.**

### 5.2 O que falta (P0/P1)
- **P0** Backup **agendado/periódico** cifrado no Servidor (o dump tem PII) + retenção + off-site.
- **P0** **Restore assistido** no instalador Servidor: *"Restaurar loja existente"* → autentica → PULL da nuvem (+ opção de subir `db.dump`).
- **P0** Ação **"trocar máquina"** no console da distribuição (re-vincula fingerprint, marca a antiga como substituída — anti-clonagem não atrapalha o DR legítimo).
- **P1** **Testar o restore** de verdade (backup nunca restaurado não é backup).

### 5.3 Runbook — Servidor queimou (novo PC)
1. Instalar em **modo Servidor**.
2. **Login e-mail/senha da empresa** (identidade vem da nuvem).
3. **Licença:** distribuição aprova **re-pareamento** (fingerprint novo) via "trocar máquina".
4. **Restauração:** PULL da nuvem devolve controle; operacional já sincronizado volta; `db.dump` (disco antigo/externo) completa o não-sincronizado.
5. **Clientes re-pareiam** com o novo Servidor (IP novo) — sem reinstalar.
   - ⚠️ Risco: vendas **desde o último sync** que não subiram se perdem se o disco foi junto → por isso backup periódico é P0.

### 5.4 Runbook — PDV (cliente) queimou
1. Instalar em **modo Cliente** (ou usar qualquer PC já com o cliente).
2. **Parear com o Servidor** → recebe o perfil.
3. Pronto — **nada a restaurar** (cliente magro não tem dado). Plug-and-play.

## 6. Roadmap por fases

> `[x]` já existe · `[ ]` a fazer. Fases 0–1 são o alicerce; sem elas, o Electron só espalha o problema.

### Fase 0 — Fundação de confiança (nuvem, antes do Electron) ✅ CONCLUÍDA
- [x] **Fronteira cloud-only × edge** definida (§8) — commit `c9dd538`.
- [x] **`@RequirePerm` fail-closed** em todos os controllers (18→44) + catálogo completo (6 chaves novas, mig 152) — commits `eaf184f`, `30ebb0c`. *(tenant-isolation centralizado no DB fica como refino contínuo.)*
- [x] **Assinatura de payload de sync** (HMAC derivado do token) + **seq anti-omissão** (mig 154, tolerante c/ flag `SYNC_REQUIRE_SIG`) — commit `e61853c`.
- [x] **Auditoria hash-chain** append-only + `verificarCadeia` (mig 153; trigger de banco já bloqueava UPDATE/DELETE) — commit `5ebd7cd`.
- Pendências de rollout: aplicar migs 152–154 na nuvem no deploy; ligar `SYNC_REQUIRE_SIG=true` só após todos os edges atualizarem; wire de `verificarCadeia`→telemetria da distribuição (follow-up).

### Fase 1 — Split do runtime (edge-core mínimo) + servidor de clientes
- [ ] Extrair **edge-core** (só operacional: comandas/PDV/KDS/fila offline) — **não** integrações/distribuição/financeiro.
- [ ] Integrações ficam na nuvem; edge recebe pedidos **normalizados** via sync (`deferirParaEdge` é o embrião).
- [ ] Edge-core serve **clientes magros** na LAN: descoberta (mDNS/IP), **pareamento por dispositivo** (cert + token, amarrado ao fingerprint), **handshake de versão**, roteamento local por setor/destino.

### Fase 2 — Proteção de código/segredos no edge
- [ ] Strip/minify/ofuscar; Electron hardening; Authenticode; DPAPI; integridade do `.asar`.
- [ ] Cripto em repouso (BitLocker + coluna sensível).

### Fase 3 — Atualização segura ✅
- [x] Updates **assinados** (Ed25519 de `versao|sha256|url`): `edge_release.assinatura` (mig 156), `edge/verify-update.mjs` (helper node), verificado no `atualizar.ps1` antes de aplicar; tolerante c/ flag `EDGE_REQUIRE_SIGNED_UPDATE`. **Anti-downgrade** (recusa versão < instalada, mesmo com -Forcar). Rollback verificado já existia (`reverter.ps1`).
- [ ] Rollout escalonado (canary %) — P2, futuro.

### Fase 4 — Antifraude + reconciliação + Backup/DR (parcial)
- [x] **Anti-rollback de relógio**: `equipamento.last_push_ts` (mig 157) + alerta de regressão no `verificarAssinatura` do sync (junto com gap/omissão de seq).
- [x] **"Trocar máquina"** (DR): `POST /equipamento/:id/trocar-maquina` reseta binding (segredo+fingerprint+ts) e gera código novo; api.ts wired.
- [x] **Backup agendado cifrado**: `edge/backup.ps1` (pg_dump + DPAPI, retenção) + schtask diário 03:00 no instalador (modo servidor). DR entre-máquinas = restore da nuvem (§5).
- [ ] **Reconciliação server-side** (nuvem recomputa caixa/CMV/estoque a partir dos eventos) — **DEFERIDO**: grande e transversal (toca todo o pipeline de vendas/caixa). Follow-up dedicado.
- [ ] **Restore assistido** no instalador (passo "restaurar loja") + teste de restore — parcial (existe `/edge/restaurar`); UI/instalador é follow-up.

### Fase 5 — Licenciamento completo
- [ ] Lease curto assinado + renovação online + janela de graça; revogação central; clone inerte.

### Fase 6 — Casca Electron + modo único
- [ ] Electron embute o edge-core (Servidor) / casca magra (Cliente); modo único local-first; status dot; internet-reserva/failover como config do Servidor.

## 7. Alavancas já existentes (reusar)
DPAPI (`proteger-env`/`decrypt-dpapi`) · cert local (`gen-cert`/`confiar-certificado`) · sync bidirecional (`sync-daemon`) · backup+rollback no update (`atualizar.ps1`/`reverter.ps1`) · telemetria da distribuição (heartbeat/erros) · revogação de licença (`revogarLicenca`) · lease+fingerprint (conceito) · roteamento por setor/destino · `deferirParaEdge`.

## 8. Fronteira cloud-only × edge (Fase 0 · frente 1 — decisão de design)

> Regra: o edge-core recebe **só o operacional**. O que é **joia** (segredos, cross-tenant, licença, integrações, consolidação, identidade) **nunca é enviado ao edge** — roda na nuvem e, quando o edge precisa, recebe **dado derivado/normalizado** via sync. Base: o grafo (`DrizzleDB` conecta tudo → o corte tem que ser explícito, não "roda o backend no edge").

### 8.1 CLOUD-ONLY (jamais no edge-core)
| Módulo / área | Por quê |
|---|---|
| `distribuicao` (console, frota, telemetria, usuários dist) | Cross-tenant, realm próprio — nunca na máquina de um cliente. |
| `licenca` | Emissão/validação de lease — a autoridade é a nuvem (senão o cliente forja licença). |
| `integracoes/*` (ifood, anotaai, food99, cardapio-web, open-delivery) + **segredos de API** | Pollers e credenciais de marketplace. Pedidos **descem normalizados** pro edge; o segredo fica na nuvem. |
| `bot`, `whatsapp` (Evolution/n8n) | Segredos `EVOLUTION_API_KEY`/`N8N_BOT_WEBHOOK`/`BOT_RESOLVER_SECRET` — regra já vigente: nunca no edge. |
| `modulo` (ativação de módulos) | Controle central do presidente/distribuição. |
| `planos` (assinatura/billing) | Financeiro de billing — nuvem. |
| `empresa`/`workspace`/`onboarding` (identidade/cadastro da empresa) | Nasce na nuvem; o edge recebe a identidade já resolvida. |
| `diretoria` / `visao_co` (consolidação multiunidade) | Análise cross-loja — nuvem. |
| `cardapio` público + `cliente` (link/OTP/cardápio online) | `cardapioBaseUrl` é **sempre nuvem** (regra vigente); QR de mesa e link do cardápio dependem da nuvem. |
| `midia` (storage canônico) | Storage na nuvem (Supabase); no edge só fallback em disco para o modo local. |
| **Reconciliação antifraude** (recompute de caixa/CMV/estoque a partir dos eventos) | A verdade financeira final é recomputada na nuvem — o edge **registra**, a nuvem **audita**. |

### 8.2 EDGE-CORE (roda local, fonte de verdade operacional)
`vendas` / `vendas-externa` (PDV, comandas) · `producao` / `producao-pedido` / `ordem-producao` (KDS) · `impressao` (worker local) · `estoque` / `contagem` / `desperdicio` / `recebimento` / `compras` / `lote` · `ponto` (marcação/NSR por equipamento) · `escala` / `dia-especial` · `checklist` / `tarefa-def` / `tarefa-instancia` / `documento` / `guias` / `vistoria` / `ocorrencia` / `pico` · `turno` (caixa) · `equipamento` / `pareamento` (dispositivos da LAN) · `delivery` **painel** (aceitar/pronto/despachar — a ingestão da integração é nuvem).

### 8.3 SYNC / BOTH (existe nos dois; nuvem é master, replica pro edge)
| Área | Direção / observação |
|---|---|
| Catálogo (`produto`, `cardapio`, `fichas`, categoria/opção/complemento) | Nuvem master → **PULL** pro edge (read-mostly local). Edição na gestão. |
| Config (`loja`, `formas_pagamento`, `fiscal_config`, `config_ramo`) | Nuvem master → PULL. |
| Cadastros base (`colaborador`, `setor`, `funcao`, `perfil`/`acessos` = RBAC) | Nuvem master → PULL (o RBAC é definido na gestão, aplicado local). |
| **Fidelidade / cashback (saldo)** | ⚠️ **Decidir**: saldo é sensível a consistência. Recomendação: **nuvem master** com cache edge; concessão/resgate offline vira **evento** reconciliado na nuvem (LWW+log) — nunca "saldo autoritativo" no edge. |
| Vendas / comandas / ponto (operacional) | Nasce no edge → **PUSH** append-only pra nuvem (idempotente, assinado). |

### 8.4 A decidir (marcado, não resolvido)
- **Fidelidade/cashback**: modelo de saldo (nuvem-master+cache vs edge-autoritativo) — ver 8.3.
- **Fiscal (NFC-e)**: emissão precisa de internet (SEFAZ) → **cloud-assisted**; contingência offline (SAT/emissão posterior) é decisão fiscal à parte.
- **Chaves de permissão sem catálogo** (frente 2): `atendimento`, `bot`, `whatsapp`, `ocorrencia`, `fichas`, `documento`, `guias`, `vistoria`, `pico`, `desligamento`, `equipamento` — criar chave nova (mig + editor) vs reusar a mais próxima.

### 8.5 Como o edge-core respeita a fronteira (implementação)
- O split é por **build/deploy**: o edge-core empacota **só** os módulos da 8.2 + o cliente de sync; os módulos da 8.1 **não entram no bundle** do edge.
- O `@cloud-only` (marcador/guard) barra, em runtime, qualquer módulo 8.1 que vaze pro edge (defense-in-depth) — pendência da auditoria-grafo (082 sem `@cloud-only`).
- Segredos: o edge recebe só o **token de serviço de escopo mínimo** (sync); nenhum segredo de terceiros.
