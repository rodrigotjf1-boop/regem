# Plano — tratamento de erros robusto e padronizado (REGEM)

> Trabalho **incremental e cirúrgico**, preservando a arquitetura (mesmo NestJS, Drizzle, guards,
> `TelemetriaLogger`/filtro, protocolo de sync). Nada de reescrita. Prioridade:
> **confiabilidade > observabilidade > segurança > consistência > elegância.**

## Diagnóstico (Fase 1 — resumo)

Base já boa: guards de auth/RBAC 100% server-side; tenant por `.tenantId` com 404 uniforme; JWT
nunca logado + revalidação no DB; filtro global (telemetria) já mascara 500; `ValidationPipe`
global; idempotência na ingestão de pedidos e venda balcão; cursor de **push** avança só após
confirmar; claim/lease anti-duplo-print no daemon do edge; tenant sólido no WebSocket.

**Lacunas transversais:** (1) sem envelope de erro padronizado (sem `code`/`requestId`); (2) sem
Request/Correlation ID; (3) frontend descarta `code`/`status`/`requestId` (só lê `message`).

**Riscos de correção (no escopo do tratamento de erros):**
| # | Sev | Onde | Essência |
|---|---|---|---|
| R1 | 🔴 | cardapio/delivery/vendas | Confirmação de pagamento não-atômica → pedido/estoque duplicado |
| S1 | 🔴 | sync-daemon push | Cursor sem `id` (keyset só timestamp) → perda silenciosa de dados |
| P1 | 🔴 | print-agent (nuvem) | Sem claim/lease → duplo-print |
| R2 | 🟠 | cardapio fallback gateway | 2ª PIX no fallback sem timeout |
| S2 | 🟠 | sync-daemon push | Linha "veneno" trava a fila inteira |
| I1 | 🟠 | integrações/pagamentos | Timeout ausente na maioria dos `fetch` |
| E1 | 🟠 | 3 daemons | Sem `unhandledRejection`/`uncaughtException` + NSSM sem throttle |
| W1 | 🟡 | realtime gateway | `kds:alerta` sem RBAC/sanitização/rate-limit |
| T1 | 🟡 | RLS off / workspace | RLS desligado por padrão; enumeração de e-mail no `/workspace` |

## Catálogo de códigos (`src/common/errors/error-codes.ts`)

`INTERNAL_ERROR` · `BAD_REQUEST` · `VALIDATION_ERROR` · `RESOURCE_NOT_FOUND` · `RATE_LIMITED` ·
`AUTH_UNAUTHENTICATED` · `AUTH_INVALID_CREDENTIALS` · `AUTH_TOKEN_EXPIRED` · `AUTH_TOKEN_INVALID` ·
`AUTH_PIN_INVALID` · `TENANT_NOT_FOUND` · `TENANT_ACCESS_DENIED` · `RBAC_PERMISSION_DENIED` ·
`ACCESS_DENIED` · `DATABASE_ERROR` · `DATABASE_CONFLICT` · `DATABASE_UNAVAILABLE` ·
`EXTERNAL_SERVICE_ERROR` · `EXTERNAL_SERVICE_TIMEOUT` · `SYNC_CONFLICT` · `SYNC_FAILED` ·
`EDGE_OFFLINE` · `PRINTER_UNAVAILABLE` · `PRINT_FAILED` · `WEBSOCKET_ERROR`.

## Blocos (ordem de execução)

- [x] **Bloco 1 — Backbone.** `common/errors/{error-codes,app-error,pg-error}.ts` + `common/request-context.ts` + `common/request-id.middleware.ts`; **estende** `telemetria-exception.filter.ts` (envelope aditivo `+code +requestId`, normaliza pg, mascara 500) e `telemetria-logger.ts` (carimba requestId); `app.module.ts` registra o middleware. Teste `errors.spec.ts`. **Sem quebra de contrato** (mantém statusCode/message/error). ✅
- [x] **Bloco 2 — Frontend client.** `ApiError {status,code,message,details,requestId}` (estende Error → 250 catches seguem) + `handleApiError` no `req()`/`pub()`; `app/error.tsx` + `global-error.tsx` (fim da tela branca); fix do skeleton infinito em `meu-dia` (redireciona sem sessão). Design system intacto. ✅
- [x] **Bloco 3 — 🔴 Pagamentos (R1/R2).** `aprovarPagamento` ATÔMICO (guarda de estado no WHERE + `returning` → só o vencedor confirma/aceita; a guarda de estado JÁ é a idempotência, sem migration de ledger). `common/gateway-erro.ts` (GatewayError + `classificarFalhaGateway`) + timeout em todas as chamadas MP/PagBank; fallback inteligente: ambíguo (timeout/5xx/rede) retenta o MESMO provider 1× (idempotency-key) e PARA — só definitivo (4xx) cai no próximo (fim da 2ª PIX). Testes `gateway-erro.spec.ts`. ✅
- [x] **Bloco 4 — 🔴 Sync push (S1/S2).** `sync-daemon.mjs` push com keyset COMPOSTO `(cursor, id)` (forma expandida/sargável = a mesma do pull da nuvem) → fim do pulo de ≥200 linhas no mesmo timestamp (S1). `enviarLote` carimba `.status`; lote rejeitado com 4xx DEFINITIVO reenvia linha a linha (`enviarLinhaALinha`) — as boas sobem, a "veneno" vira dead-letter e é pulada; 5xx/rede re-tenta o lote (S2). Protocolo intacto. ✅ *(edge — precisa validar no edge + `.zip`/`.exe`)*
- [x] **Bloco 5 — 🔴 Impressão (P1) + Edge (E1).** E1: handlers `unhandledRejection` (loga) + `uncaughtException` (loga+exit 1) nos 3 daemons (impressao/print-agent/edge-web); NSSM `AppExit/AppThrottle 5s/AppRestartDelay 3s` (reinício sem crash-loop). P1: o `jobsPendentes` da NUVEM já faz claim atômico (`for update skip locked` + lease 120s, mig 221) — a auditoria errou; o resíduo real (ACK silencioso `.catch(()=>{})` → reimpressão após a lease) foi corrigido com ACK+retry+log no `print-agent.mjs`. ✅ *(edge — precisa validar + `.zip`/`.exe`)*
- [x] **Bloco 6 — Integrações (I1).** `common/fetch-externo.ts` (`fetchExterno` = fetch + timeout 10s + normalização p/ `EXTERNAL_SERVICE_TIMEOUT/ERROR`, não lança em não-2xx). Aplicado a 26 chamadas em ifood/food99/cardapio-web/open-delivery/anotaai + whatsapp.service — fim do request/poller pendurado. ✅
- [x] **Bloco 7 — WebSocket (W1).** `realtime.gateway.ts`: `kds:alerta` exige `role='gestor'` (device não broadcasta) + sanitiza titulo/detalhe (tira controle, corta tamanho) + rate-limit (~1/2s); `device:ping` rate-limit de escrita (1/10s). `realtime.gateway.spec.ts` (4 testes). **T1 (enumeração workspace + RLS-por-padrão) ADIADO** — 🟡, mexe no login/infra e pede decisão de produto. ✅
- [x] **Bloco 8 — Testes negativos.** Cobre o CÓDIGO NOVO/alterado do épico: `errors.spec.ts` (mapeador pg, envelope aditivo, mascaramento 500), `gateway-erro.spec.ts` (classificação do fallback de pagamento), `realtime.gateway.spec.ts` (RBAC/sanitização/rate-limit do WS). Cobertura negativa exaustiva por módulo (auth/tenant/pedidos legados) segue como esforço contínuo sobre os 149 testes já existentes. ✅

Após cada bloco: `npm test` + `npm run build` verdes antes de seguir. PR/merge dos 🔴 só com
confirmação do gestor (produção). Testes vivem em `src/**/*.spec.ts` (jest + ts-jest, rootDir=src).
