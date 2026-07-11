; Regem Edge — instalador de um clique (Inno Setup 6+).
; Compile no Windows com o Inno Setup (https://jrsoftware.org/isdl.php).
; Pré: gere a pasta distribuível antes -> na pasta backend/: npm run build && node edge/package.mjs
;      (cria ../regem-edge-dist). Ajuste SourceDir abaixo se necessário.
;
; O que faz: copia o appliance para C:\regem-edge\backend, abre o .env.local para
; preencher, e roda o setup-edge.ps1 (deps + banco + migrations + cert + serviços).
; NOTA: valide num Windows real — não foi testado neste ambiente.

#define AppName "Regem Edge"
#define AppVer "1.0"

[Setup]
AppName={#AppName}
AppVersion={#AppVer}
DefaultDirName=C:\regem-edge
DefaultGroupName=Regem Edge
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputBaseFilename=RegemEdgeSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
; Copia a pasta distribuível (gerada por edge/package.mjs) para {app}\backend
Source: "..\..\regem-edge-dist\*"; DestDir: "{app}\backend"; Flags: recursesubdirs createallsubdirs
; Modelo de env
Source: "..\..\regem-edge-dist\edge\.env.local.example"; DestDir: "{app}\backend"; DestName: ".env.local"; Flags: onlyifdoesntexist

[Run]
; 1) Abre o .env.local para o técnico preencher (Postgres, SYNC_TOKEN, chave pública…)
Filename: "notepad.exe"; Parameters: """{app}\backend\.env.local"""; Description: "Preencher configuração (.env.local)"; Flags: postinstall waituntilterminated
; 2) Roda o setup (pede a senha do Postgres e o IP via prompt do PowerShell)
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\backend\edge\setup-edge.ps1"" -Raiz ""{app}\backend"""; \
  Description: "Instalar serviços do Regem Edge"; Flags: postinstall runascurrentuser

[Messages]
WelcomeLabel2=Este assistente instala o servidor local do Regem (backend + sync). Requer Node 20+, PostgreSQL, NSSM e OpenSSL já instalados. Consulte edge\INSTALL-WINDOWS.md.
