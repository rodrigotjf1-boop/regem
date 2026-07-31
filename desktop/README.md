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

## Assinatura (Authenticode)

**Rota escolhida: CA interna do Regem (custo zero/ano).** Como a distribuição controla
as máquinas e o instalador já planta+confia um CA local, emitimos nosso próprio
certificado de code-signing e o confiamos em cada máquina (Root + TrustedPublisher).
Por ser cert **interno**, a regra de HSM de 2023 **não** se aplica — o `.pfx` comum vale.

### Passo 1 — gerar a CA de assinatura (UMA vez, na máquina da distribuição)
```
cd backend && node edge/gerar-ca-assinatura.mjs --cn="DMS Regem"
```
Produz:
- `backend/edge/code-signing-ca.pem` — **público**, commitar (o instalador o confia).
- `desktop/signing/code-signing.pfx` — **segredo** (chave privada), fica **só** com a
  distribuição, num cofre. Já está no `.gitignore`; nunca vai pro repo nem pro edge.
- imprime a **senha do .pfx** (guardar na hora — não é recuperável).

### Passo 2 — build assinado (na máquina da distribuição)
As envs de assinatura são o padrão do electron-builder (ausentes = build sem
assinatura, sem erro — bom p/ CI/dev):
```
cd desktop
setx CSC_LINK "C:\...\Regen\desktop\signing\code-signing.pfx"
setx CSC_KEY_PASSWORD "<senha do passo 1>"
npm install && npm run dist   # -> dist\Regem Setup.exe assinado
```
O timestamp RFC-3161 já está no `package.json` (`rfc3161TimeStampServer`) — a assinatura
continua válida mesmo depois do cert expirar.

### Passo 3 — validar
```
signtool verify /pa /v "dist\Regem Setup.exe"
```
Numa máquina que rodou o instalador (logo confia a CA), o Explorer mostra o publisher
em Propriedades → **Assinaturas digitais**, sem "editor desconhecido".

### ⚠️ A 1ª execução do instalador numa máquina VIRGEM
O próprio instalador é o 1º `.exe` — roda **antes** de a CA ser confiada. Então, só nessa
primeira vez, o Windows ainda mostra "editor desconhecido" (o **SmartScreen** é por
reputação online e pode alertar em `.exe` baixado da web, independente da cadeia). Depois
que o instalador roda (confia a CA), **app, updates e re-execuções ficam limpos**.
Contornos para a 1ª vez: o técnico da distribuição clica **"executar assim mesmo"** uma
vez; **ou** entregar por **pendrive** (sem "marca da web" → o SmartScreen normalmente nem
dispara); **ou** pré-plantar a `code-signing-ca.pem` por **GPO** em frota gerenciada.

### Alternativa futura — CA pública (selo "publisher verificado" p/ download na internet)
Se um dia houver download público em massa, a rota interna não basta (SmartScreen é por
reputação). Aí compra-se **Certum OV** (~US$ 99/ano, atende BR, nuvem SimplySign) e
troca-se o `.pfx` interno pelo cert da Certum (mesmo `CSC_LINK`, ou `win.certificateSubjectName`
com o cert no repositório do Windows). O **Azure Trusted Signing** (US$ 9,99/mês) é mais
barato, mas só US/CA/UE/UK — CNPJ BR fora.

## Auto-update (futuro)
`electron-updater` sobre o mesmo canal de release assinado (Ed25519) da Fase 3 —
plugar quando a distribuição publicar os instaladores do desktop.
