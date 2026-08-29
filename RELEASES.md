# RELEASES — fonte da verdade do que é empacotado/distribuído

> Instalador (`.exe`) e atualização (`.zip`) do **edge**, e **APKs**. **Consulte antes de gerar** qualquer artefato e **atualize ao mesclar** cada PR com mudança distribuível. Regras completas em `CLAUDE.md` › "Releases".

## Regras rápidas

- **Acumular, não empacotar a cada alteração.** Em criação/testes/correção, registre a pendência aqui e junte. Só **cortar release** (gerar `.zip`/`.exe`/`.apk`) quando acumular vários PRs **ou o usuário pedir**.
- **`.zip`** (atualização de backend/edge, não-destrutivo): a cada corte com mudança de backend/edge.
- **`.exe`** (instalador, reinstala limpo): só se tocou **`sync`/`edge`** (scripts `backend/edge/*`, `sync-config`/`sync-daemon`, deps embutidas, `.iss`) ou para manter instalação nova na versão corrente. Sai **sempre versionado** com o `AppVer` do `regem-edge.iss`.
- **Como cortar (OBRIGATÓRIO):** `powershell -File backend\edge\build-release.ps1 -Versao X.Y.Z` → só compilar no Inno / rodar `publicar.ps1` no **"TUDO OK"** do preflight. Nunca de árvore atrás do `origin/main`, nunca de `regem-edge-dist` reaproveitado.
- **Publicar `.zip`:** `edge/publicar.ps1` → sobe no Supabase Storage (bucket `edge-updates`, nome exato `regem-edge-X.Y.Z.zip`) → publica no console de distribuição.

## Estado atual do edge

- **Última versão boa publicada:** `1.19.0` (baseline no `origin/main`).
- **`1.20.0` — QUEIMADA (não usar):** saiu quebrada (RegemEdgeWeb em loop *"Cannot find module 'next'"* + transacional não descia) por ter sido buildada de árvore **158 commits atrás** do `origin/main` e com o web como pasta em vez de `web.tar`. Corrigido pela disciplina de build (`build-release.ps1` + `preflight-release.mjs`).

## Próxima release: `1.21.0` (a cortar)

Traz, do `origin/main`, o que a 1.20 não tinha:
- **web.tar com `node_modules/next`** — RegemEdgeWeb sobe (fim do loop de crash).
- **pull KEYSET por tabela** (#393) — tabela grande/empates não "pulam".
- **pull don't-abort** — linha "veneno" não trava o pull; o **transacional volta a descer** (comandas/vendas/dashboard/pedido_externo).
- **hardening PG** (#393).
- Tooling novo: `build-release.ps1` + `preflight-release.mjs` (trava build ruim).

> Cortar com: `build-release.ps1 -Versao 1.21.0` → preflight verde → Inno. **`.exe`** (tocou sync/edge) **e** **`.zip`**.

## Histórico

| Versão | Data | Tipo | Notas |
|---|---|---|---|
| 1.21.0 | _(a cortar)_ | .exe + .zip | web.tar+next, pull keyset+don't-abort, hardening PG; via build-release.ps1 |
| 1.20.0 | 29/08/2026 | ❌ queimada | build de árvore defasada; web sem next; transacional travado |
| 1.19.0 | — | baseline | último estado bom no origin/main antes da disciplina de build |
