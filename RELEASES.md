# RELEASES — fonte da verdade do que é empacotado/distribuído

> Instalador (`.exe`) e atualização (`.zip`) do **edge**, e **APKs**. **Consulte antes de gerar** qualquer artefato e **atualize ao mesclar** cada PR com mudança distribuível. Regras completas em `CLAUDE.md` › "Releases".

## Regras rápidas

- **Acumular, não empacotar a cada alteração.** Em criação/testes/correção, registre a pendência aqui e junte. Só **cortar release** (gerar `.zip`/`.exe`/`.apk`) quando acumular vários PRs **ou o usuário pedir**.
- **`.zip`** (atualização de backend/edge, não-destrutivo): a cada corte com mudança de backend/edge.
- **`.exe`** (instalador, reinstala limpo): só se tocou **`sync`/`edge`** (scripts `backend/edge/*`, `sync-config`/`sync-daemon`, deps embutidas, `.iss`) ou para manter instalação nova na versão corrente. Sai **sempre versionado** com o `AppVer` do `regem-edge.iss`.
- **Como cortar (OBRIGATÓRIO):** `powershell -File backend\edge\build-release.ps1 -Versao X.Y.Z` → só compilar no Inno / rodar `publicar.ps1` no **"TUDO OK"** do preflight. Nunca de árvore atrás do `origin/main`, nunca de `regem-edge-dist` reaproveitado.
- **Publicar `.zip`:** `edge/publicar.ps1` → sobe no Supabase Storage (bucket `edge-updates`, nome exato `regem-edge-X.Y.Z.zip`) → publica no console de distribuição.

## F1/F2/F3 — ✅ cortado no 1.24.0 (31/08)

Programa **Gestão de Frota Edge** (`docs/plano-frota-edge.md`) — mesclado e **empacotado no 1.24.0**:
- **F1 — saúde da frota (#397/#398):** `sync-daemon.mjs` enriquece o heartbeat (`coletarSaude`/`statusServicosEDisco`/`fpEdge` + unidade). → **`.zip` + `.exe`** (tocou `sync-daemon`). Cloud: **migration 219** (`edge_heartbeat` += `unidade_id`/`fingerprint`/`saude`) — _aplicada na nuvem._
- **F2 — impressão por unidade (#401/#402):** `impressao-daemon.mjs` + processadores escopados por `EDGE_UNIDADE_ID` (matriz não imprime em filial). → **`.zip` + `.exe`** (tocou `impressao-daemon`). Cloud: só código.
- **F3 — trava de instalação anti-clone (#403/#404/#405):** `instalar-tudo.ps1` trata `reauthRequired` (2FA e-mail/TOTP) e move o edge rotacionando o token. → **`.exe`** (instalador). Cloud: **migration 220** (`ativacao` += `reauth_*` + `reautorizacao_edge`) — **⚠️ aplicar na nuvem** (código já deployado lê essas colunas). Console em `/frota` (autodeploy).

> Empacotado no **1.24.0** (abaixo). Migrations: **219 (F1)** e **220 (F3)** aplicadas na nuvem (31/08).

## Última release: `1.24.0` — cortada (31/08/2026), dist VERIFICADO

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
| 1.24.0 | 31/08/2026 | .exe + .zip (a compilar/publicar) | F1 saúde + F2 impressão/unidade + F3 trava anti-clone/instalador 2FA + blindagem migration-lag; superset dos fixes de sync 1.22/1.23 (#397–#407); migs 219+220 na nuvem |
| 1.23.0 | ~30/08/2026 | .exe + .zip | restore FK-órfão acumulado (instalação nova conclui) |
| 1.22.0 | ~30/08/2026 | .exe + .zip | fetch failed: IPv4-first + retry (rede + 5xx GET) + causa real; reset-restore.ps1 (#395, #396) |
| 1.21.0 | 29/08/2026 | .exe + .zip | web.tar+next (RegemEdgeWeb sobe), pull keyset+don't-abort, hardening PG; **sync ainda batia fetch failed** (corrigido no 1.22) |
| 1.20.0 | 29/08/2026 | ❌ queimada | build de árvore defasada; web sem next; transacional travado |
| 1.19.0 | — | baseline | último estado bom no origin/main antes da disciplina de build |
