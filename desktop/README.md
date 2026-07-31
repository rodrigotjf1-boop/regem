# Regem Desktop (casca Electron — Fase 6)

Casca nativa que abre o Regem em tela cheia (sensação de app), **modo único local-first**:
por padrão fala com o **servidor** (edge na LAN / localhost); se ele não responde, cai
pra **nuvem** com um *status dot* (local/nuvem/offline) e volta ao local sozinho.

## Configuração
`%APPDATA%\Regem\regem-desktop.json` (ou as envs `REGEM_SERVER_URL` / `REGEM_CLOUD_URL`):
```json
{ "server": "https://192.168.0.10:3001", "cloud": "https://app.dmsregem.com" }
```
- **Servidor (mesma máquina):** `server` = `https://localhost:3001`.
- **Cliente magro (na LAN):** `server` = `https://<IP-do-Servidor>:3001` (o instalador
  `-Modo cliente -ServidorHost <ip>` já confia o cert e cria o atalho).

## Endurecimento (já aplicado no `main.js`)
`contextIsolation:true` · `nodeIntegration:false` · `sandbox:true` · `webSecurity:true` ·
DevTools **off** em produção · `kiosk`/fullscreen · menu removido · **nova janela e
navegação externa bloqueadas** (abrem no navegador do sistema) · permissões restritas.
Atalhos de suporte: `Ctrl+Shift+Q` (sair) · `Ctrl+Shift+R` (recarregar).

## Build (Windows)
```
cd desktop
npm install
npm run dist    # electron-builder --win → dist\Regem Setup.exe (NSIS)
```

## Assinatura (Authenticode) — pendente de certificado
`electron-builder` assina se as envs do cert estiverem presentes:
```
setx CSC_LINK   "C:\caminho\certificado.pfx"
setx CSC_KEY_PASSWORD "<senha>"
npm run dist
```
Ou manualmente: `signtool sign /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /a "dist\Regem Setup.exe"`.
Sem cert de code-signing, o SmartScreen alerta na 1ª execução — adquirir o cert é o passo que falta.

## Auto-update (futuro)
`electron-updater` sobre o mesmo canal de release assinado (Ed25519) da Fase 3 —
plugar quando a distribuição publicar os instaladores do desktop.
