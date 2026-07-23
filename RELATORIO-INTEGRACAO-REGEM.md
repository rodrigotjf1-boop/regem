# Relatório de integração — Monitor de Visão → Regem

> **Diagnóstico + plano. Nada foi implementado.** Fonte: inspeção do código do Regem em 20/07/2026 (backend NestJS + Drizzle, frontend Next.js 14). Todas as afirmações têm `arquivo:linha` para conferência.

---

## Resumo em 30 segundos

- O Regem **já tem toda a infra necessária** para consumir o Monitor sem subir nada novo: receiver autenticado por secret (padrão edge/telemetria), tabela genérica de módulo ativável, canal de tempo real (Socket.IO), scheduler cron multi-tenant e — surpresa boa — **uma tabela `janela_pico` que espelha o `PUT /contexto/pico` do Monitor**.
- **Não existe** hoje: uma tabela de "evento de monitoramento", uma tela para ver esses eventos, nem sino/badge de notificação. Isso é o que falta construir.
- **Recomendação:** abordagem **híbrida 1+3** — receiver push no Regem (Opção 1) como caminho principal, mantendo o n8n só para o WhatsApp (Opção 3 evita dupla notificação). Polling (Opção 2) só como fallback de dashboard histórico. Detalhe na seção 4.
- **Acoplamento:** a dependência fica 100% no sentido Regem → API do Monitor (o Regem é cliente). O Monitor continua vendável isolado. ✔️ respeita a restrição do briefing.

---

## 1. Stack e estrutura do Regem

| Item | Realidade no código |
|---|---|
| **Backend** | NestJS 10 + TypeScript, Drizzle ORM sobre `pg` (Postgres/Supabase). Prefixo global `api/v1` (`backend/src/main.ts:66`). |
| **Frontend** | Next.js 14 (App Router) + Tailwind. Telas em `frontend/src/app/*`, cliente HTTP em `frontend/src/lib/api.ts`. |
| **Banco** | **Postgres** (Supabase na nuvem; Postgres embutido no edge). Schema único e tipado em `backend/src/db/schema.ts`. |
| **Migrations** | SQL escrito à mão em `database/migrations/NNN_nome.sql`, aplicado por `backend/scripts/apply-sql.mjs`. Já vamos na 130. **Toda mudança de schema = novo `.sql` + coluna/tabela no `schema.ts`.** |
| **Organização** | Um módulo por domínio em `backend/src/modules/*` (controller + service + module + dto). Auth em `backend/src/auth/*`. |
| **Rotas** | Declaradas por controller; sem JWT global — cada endpoint escolhe seu guard (ver seção 2). Único guard global é `ThrottlerGuard` (`backend/src/app.module.ts:144`). |
| **Multi-tenant** | Tudo carrega `tenant_id` (tabela `empresa`) e, quando transacional, `unidade_id` (tabela `unidade` = "loja", `schema.ts:40`). Helpers de escopo em `backend/src/common/filtro-unidade.ts`. |
| **Deploy** | EasyPanel (`regem-api`, `regem-web`) + Supabase; auto-deploy no push da `main`. Também roda **no edge** (mini-PC na loja) — relevante porque o Monitor também é on-premise. |

---

## 2. Inventário do que já existe (relevante à integração)

### 2.1 Como o Regem recebe chamadas externas hoje — **já há padrão pronto**

O Regem **já consome eventos de terceiros e do edge**. Os padrões relevantes:

- **Receiver de telemetria do edge** — `POST /api/v1/edge/telemetria` (`backend/src/modules/edge/edge.controller.ts:83`), protegido por **`SyncTokenGuard`** via header `x-sync-token`. O guard (`backend/src/modules/sync/sync-token.guard.ts:19`) valida o token contra `equipamento.token` e injeta `{ tenantId, unidadeId, equipamentoId }` no request — **o tenant vem do token, nunca do body** (anti-spoof). Redige PII antes de persistir e faz dedup. **Este é o molde exato do receiver do Monitor.**
- **Ingestão de pedidos delivery do edge** — `POST /api/v1/delivery/ingest` (`backend/src/modules/delivery/delivery.controller.ts:28`), mesmo `SyncTokenGuard`. Prova que "sistema externo → POST autenticado por secret → persiste por tenant" já é caminho batido.
- **Webhooks de pagamento** (Mercado Pago/Iugu) — públicos, sem HMAC, mas seguros por **re-consulta server-to-server** ao gateway (`cardapio.service.ts:1178,1201`). Padrão de "gatilho não confiável + verdade puxada".
- **Resolução por secret compartilhado** (modelo WhatsApp/n8n) — `whatsapp.service.ts:118` valida `BOT_RESOLVER_SECRET` e resolve `instancia → tenantId`. Alternativa ao token de device quando quem chama não é um "equipamento".

**Guards disponíveis** (todos em `backend/src/auth/`, exceto o de sync):
`JwtAuthGuard` (sessão de usuário), `RolesGuard` + `@Roles(...)`, `PermissoesGuard` + `@RequirePerm(...)` (RBAC configurável), `ModuloGuard` + `@RequireModulo(...)` (gating por módulo ativável), `SyncTokenGuard` (device/edge), `DistribuicaoGuard` (console da distribuição), `ThrottlerGuard` (global). **Não existe `@Public()`** — rota pública = rota sem `@UseGuards`.

### 2.2 Onde os alertas apareceriam

- **KDS** (`frontend/src/app/kds/page.tsx`) — **tempo real via WebSocket** (Socket.IO), não polling. Recebe um "nudge" e refaz o GET. Já tem um canal de alerta pronto: `socket.on('kds:alerta', …)` toca bip e empilha aviso (`kds/page.tsx:164`). É o destino natural de um evento de urgência alta.
- **Canal de tempo real** — `backend/src/modules/realtime/realtime.gateway.ts:34`. Ponte **EventEmitter2 (Nest, in-process) → Socket.IO**, salas por `tenant:<id>` / `unidade:<id>` / `kds:<tenant>`. Autentica handshake por token de device **ou** JWT de gestor. Emitir um `monitor.evento` novo e espelhar em `kds:alerta` já chegaria ao KDS **sem escrever polling**.
- **Dashboards** — gerente/presidente (`frontend/src/app/painel/page.tsx`) e Visão C&O (`frontend/src/app/diretoria/page.tsx`): hoje **fetch único no load, sem live**. Para "piscar" em tempo real precisariam de um listener socket novo (hoje não têm).
- **Mural** (`frontend/src/app/mural/page.tsx`, tabelas `comunicado`/`comunicadoLeitura`, `schema.ts:1341`) — comunicação interna com confirmação de leitura, mas **fetch no mount, sem live**.

### 2.3 Modelo de "alerta/notificação" no banco — parcial

Não há tabela genérica de evento externo. As candidatas (`backend/src/db/schema.ts`):

| Tabela | Linha | Serve? |
|---|---|---|
| `alertaEstoque` | 1438 | Alerta resolvível (título/detalhe/prioridade/`resolvidoEm`), mas `tipo` restrito a estoque, **sem `setorId`**. |
| `auditLog` | 1322 | Genérica, tem `origem` + `detalhe jsonb`, mas **sem `setorId`/`status`/`urgencia`**; é append-only de auditoria. |
| `vistoria` | 507 | **Modelo estrutural mais fiel**: `unidadeId` + `setorId` + `observacao` + `fotoRef` + `status`. Orientada a inspeção manual. |
| `ocorrencia` | 688 | Tem setor/status/foto, mas **exige `colaboradorId`** (não serve para evento anônimo de zona → conflita com a regra "nunca por pessoa" do Monitor). |

**Conclusão:** melhor criar tabela nova (`evento_monitoramento`), espelhada em `vistoria`. Detalhe na seção 5.

### 2.4 `setor` — a "zona" do Monitor já existe

`setor` (`schema.ts:172`): `tenantId`, `unidadeId`, `nome`, `icone`, **`cor`**, soft-delete. É exatamente a "zona/setor" que o Monitor monitora. Já tem vínculo a equipamentos (KDS/impressora) via `equipamento.setorId` (`schema.ts:744`) e `setor_destino_producao` (`schema.ts:1613`). O evento do Monitor traz `setor.nome` + `canal` — mapeável a `setor.id` por nome ou por uma tabela de-para canal→setor (ver seção 5).

### 2.5 Scheduler — pronto e reutilizável

`@nestjs/schedule` global (`app.module.ts:77`). `JobsService` (`backend/src/modules/jobs/jobs.service.ts`) já tem 7 `@Cron` multi-tenant (iteram `tenantsAtivos()`, `jobs.service.ts:50`), ex.: `pontoDePedido` às 06:00 emitindo `kds.alerta.sistema`. **Adicionar um cron que empurra a janela de pico ao Monitor é só mais um método aqui.**

### 2.6 Módulo ativável — infra pronta, sem migration

`modulo_ativacao` (`schema.ts:161`) é genérica (`modulo` string, `unidadeId null = padrão da rede`). Lista canônica em `modulo.service.ts:9` (`app_colaborador`, `kds`, `terminal_ponto`, `bot`). Enforcement por `@RequireModulo('chave')` + `ModuloGuard`. **Registrar `monitor_visao` como módulo ligável/desligável pelo presidente não exige schema novo** — só entrada na lista + guard nos controllers.

### 2.7 Cliente HTTP de saída — padrão definido

`fetch` nativo (sem axios), URL+secret em **env vars**, header de auth custom, `.catch(()=>{})` para não derrubar o fluxo. Exemplos: telemetria edge→nuvem (`telemetria.interceptor.ts:37`), WhatsApp/Evolution (`whatsapp.service.ts:27`), pagamentos (`common/mercadopago.ts`, `common/iugu.ts`). **É o molde para o Regem chamar a API do Monitor** (`PUT /contexto/pico`, `POST /assinaturas`).

---

## 3. Lacunas (o que falta)

1. **Receiver do Monitor** — não há `POST /monitor/eventos`. Falta criar (molde: `edge/telemetria`).
2. **Persistência** — não há tabela `evento_monitoramento`. Falta migration + `schema.ts`.
3. **De-para `canal → setor/unidade`** — o evento traz `setor.canal` (nº do canal do DVR) e `loja.id`; o Regem precisa saber a que `unidade_id`/`setor_id` isso corresponde. Não existe.
4. **Autenticação do Monitor→Regem** — o Monitor não é um `equipamento` cadastrado nem tem JWT. Precisa de um secret/token dedicado (decidir modelo — seção 6, pergunta 1).
5. **Tela de eventos** — nenhuma tela lista/filtra eventos de conformidade. Falta em painel/diretoria e/ou KDS.
6. **Sino/badge global** — inexistente no Shell (`frontend/src/components/app-shell/shell.tsx`). Precisa ser criado do zero se quisermos contador de não-lidos.
7. **Live nos dashboards** — `painel` e `diretoria` são fetch-no-load; sem listener socket não "piscam" em tempo real (o KDS já pisca).
8. **Push da janela de pico** — `janela_pico` existe e tem CRUD (`pico.service.ts`), mas **nenhum job a lê** (`intensidade` marcada "uso futuro", `schema.ts:222`); nada hoje envia essas janelas a lugar nenhum. Falta o cron + o cliente HTTP.
9. **Módulo ativável** — `monitor_visao` ainda não está registrado.
10. **Snapshot/imagem** — o evento pode trazer `snapshot_base64` (foto da loja, dado sensível LGPD). Não há decisão de onde/se guardar. O Regem já tem storage de mídia com expurgo LGPD (`midia`, expurgo em `jobs.service.ts:58`) — reaproveitável, mas precisa política de retenção.

---

## 4. Plano de integração proposto

### Decisão: **híbrido Opção 1 (push) + Opção 3 (n8n só WhatsApp)**, com Opção 2 como leitura histórica opcional

| Abordagem | Papel no plano | Porquê |
|---|---|---|
| **Opção 1 — Regem assina a API do Monitor (push)** | **Principal.** O Regem expõe `POST /api/v1/monitor/eventos`; registra-se no Monitor via `POST /assinaturas` apontando para essa URL. Eventos chegam por push, o Regem grava e reemite no Socket.IO. | Tempo real de verdade para o KDS (que já é event-driven). Menor latência. Reaproveita 100% o padrão `edge/telemetria` + `RealtimeGateway`. |
| **Opção 3 — n8n grava no Regem** | **Complementar, e mantém o WhatsApp.** O n8n continua dono do WhatsApp (não duplicar). *Se* preferirmos não expor receiver ao Monitor diretamente, o n8n — que já recebe o evento — faz um `POST` extra ao `POST /monitor/eventos` do Regem. | Evita **dupla notificação**: WhatsApp = n8n; registro/tela/KDS = Regem. Reusa o roteamento que já funciona. |
| **Opção 2 — Regem consulta `GET /eventos` (polling)** | **Fallback/histórico.** Dashboards podem puxar `GET /eventos`/`GET /status` do Monitor para telas de histórico e "saúde do monitor". | Bom para histórico e status, ruim para tempo real. Não é o caminho quente. |

**Regra de ouro contra dupla notificação:** **WhatsApp → só n8n. Tela/KDS/registro → só Regem.** O Regem **não** dispara WhatsApp de evento de monitoramento.

**Melhor para cada alvo:**
- **KDS (tempo real):** Opção 1 → `RealtimeGateway` emite `kds:alerta`. Já pronto do lado do cliente.
- **Dashboards (histórico):** ler da própria tabela `evento_monitoramento` (gravada pela Opção 1/3); Opção 2 (`GET /eventos` do Monitor) só se quisermos histórico que o Regem não guardou.

**Quem chama quem (sempre Regem → Monitor, nunca o contrário no acoplamento de produto):**
- Monitor → Regem: só o push HTTP do evento (desacoplável; se o Regem cair, o Monitor segue vendendo e notificando via n8n).
- Regem → Monitor: `POST /assinaturas` (registrar o receiver) e `PUT /contexto/pico` (seção 7). Ambos com `Authorization: Bearer <API_KEY>` em env var.

### Fluxo alvo (Opção 1)

```
Monitor (loja) --POST /api/v1/monitor/eventos (secret)--> Regem API
   Regem: resolve tenant/unidade/setor  →  grava evento_monitoramento
        →  EventEmitter 'monitor.evento'  →  RealtimeGateway
              →  KDS (kds:alerta + bip)   |   painel/diretoria (listener novo)
   n8n (em paralelo, já existente)  →  WhatsApp  (NÃO no Regem)
```

---

## 5. Schema de banco proposto (não implementado)

Tabela nova, espelhando `vistoria` + campos do contrato de evento. Migration seria `131_monitor_visao.sql` + `schema.ts`.

```sql
-- database/migrations/131_monitor_visao.sql  (PROPOSTA — não aplicada)

-- 1) de-para: canal do DVR -> unidade/setor do Regem
create table monitor_zona (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references empresa(id) on delete cascade,
  unidade_id   uuid not null references unidade(id) on delete cascade,
  setor_id     uuid references setor(id),          -- zona do Monitor -> setor Regem
  loja_ref     text not null,                       -- "loja.id" que o Monitor manda (ex.: "loja-01")
  canal        int  not null,                       -- setor.canal do evento (canal do DVR)
  nome         text,                                -- rótulo amigável ("Chapa / Grelha")
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (tenant_id, loja_ref, canal)
);

-- 2) evento de conformidade recebido do Monitor (append-only + resolvível)
create table evento_monitoramento (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references empresa(id) on delete cascade,
  unidade_id     uuid not null references unidade(id) on delete cascade,
  setor_id       uuid references setor(id),
  evento_id_ext  text,                    -- evento_id (uuid) do Monitor — idempotência/dedup
  origem         text not null default 'monitor-visao',
  versao_schema  text,                    -- "2.0"
  tipo           text,                    -- 'conformidade' | 'falha_captura'
  verificacao    text,                    -- verificacao.nome ("EPI na chapa")
  criterio       text,
  status         text not null,           -- resultado.status: 'conforme' | 'nao_conforme' | ...
  confianca      numeric(4,3),            -- 0.000..1.000
  observacao     text,                    -- resultado.observacao
  urgencia       text not null default 'baixa',  -- 'alta' | 'media' | 'baixa'
  canal          int,
  snapshot_ref   text,                    -- ponteiro p/ mídia (NÃO base64 inline) — LGPD
  event_ts       timestamptz,             -- timestamp do evento no Monitor
  resolvido_em   timestamptz,
  resolvido_por  uuid references colaborador(id),
  created_at     timestamptz not null default now(),
  unique (tenant_id, evento_id_ext)       -- idempotência do push
);
create index idx_evt_mon_tenant_uni_data on evento_monitoramento (tenant_id, unidade_id, created_at desc);
create index idx_evt_mon_status on evento_monitoramento (tenant_id, status, resolvido_em);
```

**Notas de design:**
- `unique(tenant_id, evento_id_ext)` = **idempotência**: reenvio do mesmo evento não duplica (padrão que o Regem já usa em sync/telemetria).
- `snapshot_ref`, **não** `snapshot_base64` inline: o base64 vira arquivo na camada de mídia (`midia`) com **expurgo LGPD** (reaproveita `expurgarFotos*` em `jobs.service.ts`). Snapshot é imagem da loja = dado sensível; nunca exposto em rota pública sem token.
- `monitor_zona` resolve o problema de o evento vir com `canal`/`loja.id` genéricos → `unidade_id`/`setor_id` reais.
- Reaproveita `setor.cor`/`icone` para render no KDS/painel sem campo novo.

---

## 6. Contrato do endpoint receiver (Opção 1) — proposta

```
POST /api/v1/monitor/eventos
Auth:   header  x-monitor-token: <secret>     (env MONITOR_INGEST_SECRET)
        — modelo idêntico ao x-sync-token do edge; resolve tenant/unidade
          por token OU por (loja.id + secret), a decidir na pergunta 1.
Throttle: 60 req/min por token (igual edge/telemetria)
Body:   o JSON do evento do Monitor, verbatim (versao_schema "2.0"):
        { evento_id, origem, versao_schema, timestamp, loja:{id,nome},
          setor:{nome,canal}, verificacao:{nome,criterio},
          resultado:{status,confianca,observacao}, urgencia_sugerida,
          snapshot_base64 | null }
        — e o formato de falha técnica { origem, tipo:'falha_captura',
          setor:{canal}, urgencia_sugerida, ... }

Resposta:
  200 { "ok": true, "evento_id": "<id interno>", "duplicado": false }
  200 { "ok": true, "duplicado": true }         // já recebido (idempotência)
  401 { "ok": false, "erro": "token inválido" }
  422 { "ok": false, "erro": "loja/canal não mapeado" }  // sem monitor_zona

Efeitos: grava evento_monitoramento (dedup por evento_id) →
         se snapshot presente, salva na mídia e guarda snapshot_ref →
         EventEmitter 'monitor.evento' → RealtimeGateway (kds:alerta).
         NÃO envia WhatsApp (isso é do n8n).
```

Molde de código: `backend/src/modules/edge/edge.controller.ts:83` (receiver) + `sync-token.guard.ts` (guard) + `realtime.gateway.ts` (emit). Um módulo novo `backend/src/modules/monitor/` (controller+service+module), sem tocar no que já existe.

---

## 7. Como o Regem enviará o contexto de pico ao Monitor

**Sorte grande: já existe `janela_pico`.** Tabela `janela_pico` (`schema.ts:208`) por `unidade_id` (com override futuro por `setor_id`), com `dia_semana`, `hora_inicio`, `hora_fim`, `intensidade`. Módulo `backend/src/modules/pico/` já tem CRUD (rota `janelas-pico`, `@Roles('presidente','gerente')`). Hoje **nada consome** essas janelas (`intensidade` = "uso futuro").

**Gatilho proposto:** um `@Cron` novo no `JobsService` (mesmo padrão dos 7 já lá), rodando ao início do dia (ex.: `10 5 * * *`, junto dos outros), que para cada tenant/unidade:
1. lê as `janela_pico` do dia (`pico.service.findAll`);
2. monta `{ ativo: true, janelas: ["11:30-14:00","18:30-21:30"] }`;
3. faz `PUT <MONITOR_API>/api/v1/contexto/pico` com `Authorization: Bearer <MONITOR_API_KEY>` (env vars, padrão `fetch` + `.catch`).

Opção mais reativa (melhor): em vez de (ou além de) cron diário, disparar o `PUT` **no CRUD do pico** (`pico.service` create/update/remove) — assim editar a janela no Regem reflete no Monitor na hora. As duas convivem (cron = garantia diária; hook = reação imediata).

**Envs novas:** `MONITOR_API_URL`, `MONITOR_API_KEY` (Bearer do Monitor), `MONITOR_INGEST_SECRET` (o que o Monitor usa para postar de volta). Todas em `regem-api` no EasyPanel + `backend/.env` local. *(Instruções detalhadas de onde colocar entram na fase de implementação.)*

---

## 8. Perguntas em aberto e suposições

### Decisões que precisam de humano

1. **Como o Monitor se autentica ao postar no Regem?** Três opções do repo:
   - (a) **Token de device** (cadastrar o Monitor como um `equipamento tipo 'servidor_local'/'monitor'` e reusar `SyncTokenGuard`) — mais integrado, mas mistura o Monitor no cadastro de equipamentos.
   - (b) **Secret dedicado + `loja.id` no body** (modelo WhatsApp `resolver(secret)`) — mais desacoplado, combina com "produto autônomo". **← recomendo esta.**
   - (c) **Assinatura HMAC** (como o Monitor assina; o Regem valida). Mais robusto, mais trabalho dos dois lados.
2. **De-para canal→setor: cadastro manual ou automático?** Proponho tela de cadastro `monitor_zona` (presidente mapeia "canal 5 = setor Chapa"). Precisa confirmar se o `loja.id` do Monitor ("loja-01") casa com `unidade_id` ou precisa de coluna `loja_ref`.
3. **Snapshot (imagem da loja): guardar ou descartar?** Guardar dá evidência mas é dado sensível (LGPD) → precisa política de retenção/expurgo e nunca rota pública. Alternativa: **não** guardar a imagem, só o texto do evento (mais seguro, perde a evidência visual). Qual?
4. **Onde os eventos aparecem primeiro?** KDS (operação imediata), painel do gerente, Visão C&O do presidente — ou os três? Isso define quanto front construir na fase 1.
5. **Sino/badge global vale a pena agora?** Não existe hoje; é um item próprio (afeta o Shell inteiro). Pode ficar para depois, começando só com a tela de lista + o alerta no KDS que já existe.
6. **`monitor_visao` como módulo ativável** (liga/desliga por rede/loja pelo presidente)? Recomendo sim — barato (`modulo.service.ts:9` + `@RequireModulo`) e coerente com KDS/Ponto/Bot.
7. **Push da janela de pico: cron diário, hook no CRUD, ou os dois?** (seção 7).

### Suposições assumidas

- O Monitor consegue chamar HTTP de saída até a nuvem do Regem (`api.dmsregem.com`) **ou** até o edge local — a decidir se o alvo do push é a nuvem ou o edge da loja. Assumi **nuvem** por simplicidade; se for edge, o receiver entra no backend que roda no edge (mesmo código, roda nos dois).
- O contrato de evento do briefing (`versao_schema 2.0`) é estável; modelei o schema com `versao_schema` e campos opcionais para tolerar evolução.
- O evento é **por zona, nunca por pessoa** (regra LGPD do Monitor) — por isso a tabela nova **não** referencia `colaborador` no evento (só em `resolvido_por`), diferente de `ocorrencia`.
- Volume de eventos moderado (não é telemetria de vídeo, só eventos de não-conformidade) → um `POST` por evento aguenta sem fila. Se o volume crescer, o padrão `@Interval` processor do repo (ex.: `edge-pedidos.processor.ts`) serve de fila.

---

## Próximo passo sugerido

Responder as perguntas 1–7 da seção 8. Com elas travadas, a implementação sai em fases pequenas: **(F1)** migration `131` + módulo receiver + emit no Socket.IO + tela de lista; **(F2)** `monitor_zona` (de-para) + módulo ativável; **(F3)** push da janela de pico; **(F4)** sino/badge + live nos dashboards (se aprovado). Nada disso foi codado ainda — como pedido, primeiro o diagnóstico.
