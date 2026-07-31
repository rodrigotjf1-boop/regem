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

> ⚠️ **Mudou em 2023/2024.** (1) A chave privada de QUALQUER cert de code-signing
> (OV **e** EV) tem que viver em hardware FIPS 140-2 (token USB ou HSM na nuvem) —
> **não existe mais o `.pfx` exportável** que o fluxo antigo `CSC_LINK`/`CSC_KEY_PASSWORD`
> usava. (2) O EV **deixou de furar o SmartScreen na 1ª execução**; OV e EV agora
> constroem reputação do mesmo jeito. Ou seja: **OV basta** pro nosso caso (appliance
> distribuído a clientes conhecidos, não download público em massa).

### Provedor recomendado (empresa BR): Certum (nuvem SimplySign)
O **Azure Trusted Signing** (mais barato, US$ 9,99/mês) só atende **EUA/Canadá/UE/Reino
Unido** — CNPJ brasileiro **não** é elegível. Para o Brasil, o padrão indie/PME é a
**Certum** (Polônia, emite mundialmente, cloud HSM SimplySign): OV ~US$ 99/ano,
EV ~US$ 299/ano. Alternativa: **SSL.com** com o **eSigner CKA** (adaptador que expõe o
cert da nuvem ao repositório de certificados do Windows).

### Como plugar no build (electron-builder ^24 = cert no repositório do Windows)
1. Comprar o cert OV na Certum (validação da empresa: CNPJ + comprovante; ~1-5 dias úteis).
2. Instalar o **proCertum SimplySign Desktop** — ele carrega o cert da nuvem no
   repositório *Pessoal* do Windows (com o token 2FA da Certum no celular).
3. Descobrir o nome exato do titular (CN) do cert:
   ```
   powershell -Command "Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Select-Object Subject,Thumbprint"
   ```
4. No `desktop/package.json`, dentro de `build.win`, apontar pro cert do repositório
   (nada de `.pfx`/senha em env) e usar timestamp RFC-3161:
   ```json
   "win": {
     "target": ["nsis"],
     "signingHashAlgorithms": ["sha256"],
     "certificateSubjectName": "DMS Regem <CN exato do passo 3>",
     "rfc3161TimeStampServer": "http://time.certum.pl"
   }
   ```
   (Alternativa determinística: `"certificateSha1": "<thumbprint do passo 3>"`.)
5. `npm run dist` — com o SimplySign Desktop aberto/logado, o electron-builder assina o
   `Regem Setup.exe` sozinho. Assinatura manual de emergência:
   `signtool sign /fd SHA256 /tr http://time.certum.pl /td SHA256 /sha1 <thumbprint> "dist\Regem Setup.exe"`.

### Validar
```
signtool verify /pa /v "dist\Regem Setup.exe"
```
Deve mostrar a cadeia até a CA e o carimbo de tempo. No Explorer: botão direito →
Propriedades → aba **Assinaturas digitais** → o titular certo aparece.

### Se um dia houver entidade elegível ao Azure Trusted Signing (US/CA/UE/UK)
Subir o `electron-builder` pra **^25** e trocar o bloco acima por `win.azureSignOptions`
(`endpoint`, `codeSigningAccountName`, `certificateProfileName`, `publisherName` = CN
exato). É a opção mais barata e sem token físico — mas só com a entidade elegível.

Enquanto não houver cert, o instalador sobe **sem assinatura** e o SmartScreen alerta na
1ª execução — adquirir o cert (Certum OV) é o único passo que falta pra fechar a Fase 6.

## Auto-update (futuro)
`electron-updater` sobre o mesmo canal de release assinado (Ed25519) da Fase 3 —
plugar quando a distribuição publicar os instaladores do desktop.
