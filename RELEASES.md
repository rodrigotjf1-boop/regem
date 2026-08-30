# RELEASES — fonte da verdade do que é empacotado/distribuído

> Instalador (`.exe`) e atualização (`.zip`) do **edge**, e **APKs**. **Consulte antes de gerar** qualquer artefato e **atualize ao mesclar** cada PR com mudança distribuível. Regras completas em `CLAUDE.md` › "Releases".

## Regras rápidas

- **Acumular, não empacotar a cada alteração.** Em criação/testes/correção, registre a pendência aqui e junte. Só **cortar release** (gerar `.zip`/`.exe`/`.apk`) quando acumular vários PRs **ou o usuário pedir**.
- **`.zip`** (atualização de backend/edge, não-destrutivo): a cada corte com mudança de backend/edge.
- **`.exe`** (instalador, reinstala limpo): só se tocou **`sync`/`edge`** (scripts `backend/edge/*`, `sync-config`/`sync-daemon`, deps embutidas, `.iss`) ou para manter instalação nova na versão corrente. Sai **sempre versionado** com o `AppVer` do `regem-edge.iss`.
- **Como cortar (OBRIGATÓRIO):** `powershell -File backend\edge\build-release.ps1 -Versao X.Y.Z` → só compilar no Inno / rodar `publicar.ps1` no **"TUDO OK"** do preflight. Nunca de árvore atrás do `origin/main`, nunca de `regem-edge-dist` reaproveitado.
- **Publicar `.zip`:** `edge/publicar.ps1` → sobe no Supabase Storage (bucket `edge-updates`, nome exato `regem-edge-X.Y.Z.zip`) → publica no console de distribuição.

## Estado atual do edge

- **`1.21.0` — cortada (29/08):** corrigiu o **web** (`web.tar` com `next` → RegemEdgeWeb sobe) + trouxe pull keyset/don't-abort. **Mas revelou** um bloqueio que estava mascarado: o daemon (serviço do Windows, processo longo) batia **`sync FALHOU: fetch failed` a cada ciclo** enquanto o `fetch` manual dava 200 — era **IPv6 que o serviço não roteia** + **socket keep-alive morto** reusado. Diagnóstico às cegas porque o daemon logava só "fetch failed" (jogava fora `e.cause`).
- **`1.20.0` — QUEIMADA (não usar):** build de árvore **158 commits atrás** + web como pasta (next truncado no MAX_PATH). Corrigida pela disciplina de build (`build-release.ps1` + `preflight-release.mjs`).

## Próxima release: `1.22.0` (a cortar)

Fix de sync que fecha o `fetch failed` (PRs #395 + #396):
- **`dns.setDefaultResultOrder('ipv4first')`** — usa IPv4 (Cloudflare) em vez do IPv6 que o serviço não roteia.
- **`fetchT` com retry** em erro transitório (ECONNRESET/socket morto reusado) **+ retry em 502/503/504 para GET** (pull/restore; push POST não re-tenta — evita duplo-apply).
- **`causaErro()`** — loga/telemetra a causa REAL aninhada (fim do "fetch failed" cego).
- **`reset-restore.ps1`** — destrava restore incompleto (flag `restaurando` presa) e re-dispara o completo, sem reinstalar.

> Cortar com: `build-release.ps1 -Versao 1.22.0` → preflight verde → Inno. **`.exe`** (recomendado p/ o potitjf: reinstala `-Limpar` e o restore completo conclui) **e** **`.zip`** (update leve; depois rodar `reset-restore.ps1` p/ refazer o restore).

## Histórico

| Versão | Data | Tipo | Notas |
|---|---|---|---|
| 1.22.0 | _(a cortar)_ | .exe + .zip | fix fetch failed: IPv4-first + retry (rede + 5xx GET) + causa real; reset-restore.ps1 (#395, #396) |
| 1.21.0 | 29/08/2026 | .exe + .zip | web.tar+next (RegemEdgeWeb sobe), pull keyset+don't-abort, hardening PG; **sync ainda batia fetch failed** (corrigido no 1.22) |
| 1.20.0 | 29/08/2026 | ❌ queimada | build de árvore defasada; web sem next; transacional travado |
| 1.19.0 | — | baseline | último estado bom no origin/main antes da disciplina de build |
