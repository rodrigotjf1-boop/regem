# RELEASES — fonte da verdade do que é empacotado/distribuído

> Instalador (`.exe`) e atualização (`.zip`) do **edge**, e **APKs**. **Consulte antes de gerar** qualquer artefato e **atualize ao mesclar** cada PR com mudança distribuível. Regras completas em `CLAUDE.md` › "Releases".

## Regras rápidas

- **Acumular, não empacotar a cada alteração.** Em criação/testes/correção, registre a pendência aqui e junte. Só **cortar release** (gerar `.zip`/`.exe`/`.apk`) quando acumular vários PRs **ou o usuário pedir**.
- **`.zip`** (atualização de backend/edge, não-destrutivo): a cada corte com mudança de backend/edge.
- **`.exe`** (instalador, reinstala limpo): só se tocou **`sync`/`edge`** (scripts `backend/edge/*`, `sync-config`/`sync-daemon`, deps embutidas, `.iss`) ou para manter instalação nova na versão corrente. Sai **sempre versionado** com o `AppVer` do `regem-edge.iss`.
- **Como cortar (OBRIGATÓRIO):** `powershell -File backend\edge\build-release.ps1 -Versao X.Y.Z` → só compilar no Inno / rodar `publicar.ps1` no **"TUDO OK"** do preflight. Nunca de árvore atrás do `origin/main`, nunca de `regem-edge-dist` reaproveitado.
- **Publicar `.zip`:** `edge/publicar.ps1` → sobe no Supabase Storage (bucket `edge-updates`, nome exato `regem-edge-X.Y.Z.zip`) → publica no console de distribuição.

## Acumulado (NÃO empacotado) — próximo `.exe`/`.zip` do edge

Mudanças **do edge** já na `main` (ou em branch) aguardando o próximo corte:
- **Reimpressão do delivery leva o QR de despacho (#416, na `main`):** `delivery.service`/`vendas.reimprimirViasExterno` — a reimpressão local rodava sem o `@QR`. → **`.zip` + `.exe`** (backend do edge).
- **Seed de cursor no fim do restore + log carimbado (branch `feat/edge-cursor-seed-log-ts`, ⚠️ NÃO mesclado):** `sync-daemon.mjs` — após `-Limpar` o ciclo baixa só o novo (não re-baixa os 60 dias) + `[data-hora]` em toda linha do log. → **`.zip` + `.exe`**. **Mesclar o branch antes de cortar.**

> **OSRM Fase 0/1 (#417) é CLOUD-ONLY** (rota no rastreio do cliente + backend por autodeploy) — **NÃO** entra no `.exe`/`.zip` do edge; sobe por autodeploy. Precisa de `OSRM_URL` no `regem-api`.

Cortar quando o gestor pedir: `build-release.ps1 -Versao X.Y.Z` de worktree off `origin/main` (que já terá o #416 + o branch mesclado).

## App do entregador (APK — fora do edge)

O app entregador **não** é `.exe`/`.zip` do edge — é **APK de instalação direta** (AAB/Play adiado "até estar mais completo"). Última versão na Play = `0.1.0` (versionCode 7). Acumulado desde então:
- **Localização em 2º plano (#419):** `getPositionStream` + foreground service → envia a cada 10s com a tela apagada; manifest += `ACCESS_BACKGROUND_LOCATION`/`FOREGROUND_SERVICE(_LOCATION)`.
- **Rota OSRM no mapa in-app (#427):** "Ver rota" desenha a NOSSA rota (OSRM) num `flutter_map` + ETA; botão "Navegar" abre Waze/Maps p/ a voz. Consome `POST /entregador/pedido/:id/rota` (#426, cloud/autodeploy).
- **Ganhos estimados (#430):** ao confirmar a entrega com código, a taxa (real/por entrega ou fixa, pelo perfil) já entra em "Meus ganhos estimados" (inclui 'entregue' pendente de conferência); cancelamento no atendimento abate sozinho. Backend `ganhos()` (cloud/autodeploy) + rótulo no app.

**Build de teste `0.1.0+10`** gerado (02/09) para sideload: `app-entregador/build/app/outputs/flutter-apk/app-release.apk` (65 MB, **release assinado com chave de debug** → instala direto; se não instalar por cima do anterior, **desinstalar** o app antes). Copiado p/ `Downloads/regem-entregador-0.1.0+10.apk`. **Play/AAB** só quando o app amadurecer (aí wire do `upload.jks` no `build.gradle.kts` + bump do versionCode).

## F1/F2/F3 — ✅ cortado no 1.24.0 (31/08)

Programa **Gestão de Frota Edge** (`docs/plano-frota-edge.md`) — mesclado e **empacotado no 1.24.0**:
- **F1 — saúde da frota (#397/#398):** `sync-daemon.mjs` enriquece o heartbeat (`coletarSaude`/`statusServicosEDisco`/`fpEdge` + unidade). → **`.zip` + `.exe`** (tocou `sync-daemon`). Cloud: **migration 219** (`edge_heartbeat` += `unidade_id`/`fingerprint`/`saude`) — _aplicada na nuvem._
- **F2 — impressão por unidade (#401/#402):** `impressao-daemon.mjs` + processadores escopados por `EDGE_UNIDADE_ID` (matriz não imprime em filial). → **`.zip` + `.exe`** (tocou `impressao-daemon`). Cloud: só código.
- **F3 — trava de instalação anti-clone (#403/#404/#405):** `instalar-tudo.ps1` trata `reauthRequired` (2FA e-mail/TOTP) e move o edge rotacionando o token. → **`.exe`** (instalador). Cloud: **migration 220** (`ativacao` += `reauth_*` + `reautorizacao_edge`) — **⚠️ aplicar na nuvem** (código já deployado lê essas colunas). Console em `/frota` (autodeploy).

> Empacotado no **1.24.0** (abaixo). Migrations: **219 (F1)** e **220 (F3)** aplicadas na nuvem (31/08).

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
