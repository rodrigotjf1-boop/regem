; Regem Edge — instalador de UM CLIQUE (Inno Setup 6+).
; Compile no Windows com o Inno Setup (https://jrsoftware.org/isdl.php).
;
; O instalador faz TODO o local automaticamente (Postgres/Node embutidos, banco,
; senha, certificado, servicos, migrations, confiar o ca.pem) e SO pede na tela
; os 3 dados da nuvem: ID da unidade, token de sync e (opcional) token de licenca.
;
; ANTES de compilar:
;   1) na pasta backend/:  npm run build && node edge/package.mjs   (gera ../regem-edge-dist)
;   2) edite as 2 constantes abaixo (CloudApi e a chave PUBLICA da licenca)
;   3) (recomendado, p/ nao exigir nada pre-instalado) coloque os binarios portateis em:
;        edge\bundle\node\   (node.exe, npm.cmd, …)        -> https://nodejs.org (zip "Windows Binary")
;        edge\bundle\pgsql\  (bin\initdb.exe, postgres.exe) -> EnterpriseDB "PostgreSQL Binaries" (zip)
;        edge\bundle\nssm\   (nssm.exe)                     -> https://nssm.cc
;      Sem esses, o instalador usa o Node/Postgres/NSSM ja instalados no PC.
; Veja edge\COMPILAR-INSTALADOR.md para o passo a passo.

#define AppName "Regem Edge"
#define AppVer  "1.0"
; ==== EDITE ESTES 2 VALORES ANTES DE COMPILAR ====
#define MyCloudApi     "https://api.dmsregem.com/api/v1"
#define MyLicensePubKey "LS0tLS1CRUdJTiBQVUJMSUMgS0VZLS0tLS0KTUNvd0JRWURLMlZ3QXlFQW9SY2phUGJjb0ZQYjk2dFBiSExFcHUzVmNDUjY1TlpwUFRuNWJWQmgwZ289Ci0tLS0tRU5EIFBVQkxJQyBLRVktLS0tLQo"   ; (nao e segredo — a mesma para todas as lojas)

[Setup]
AppName={#AppName}
AppVersion={#AppVer}
DefaultDirName=C:\regem-edge
DisableProgramGroupPage=yes
PrivilegesRequired=admin
OutputBaseFilename=RegemEdgeSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern

[Files]
; App (gerado por edge/package.mjs) -> {app}\backend
Source: "..\..\regem-edge-dist\*"; DestDir: "{app}\backend"; Flags: recursesubdirs createallsubdirs
; Binarios portateis EMBUTIDOS (opcionais) — se a pasta existir, sao empacotados:
Source: "bundle\node\*";  DestDir: "{app}\node";  Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "bundle\pgsql\*"; DestDir: "{app}\pgsql"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "bundle\nssm\*";  DestDir: "{app}\nssm";  Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
; Runtime do Windows (VC++ x64) — o Postgres embutido precisa dele. Coloque em
; edge\bundle\vc_redist.x64.exe (baixe: https://aka.ms/vs/17/release/vc_redist.x64.exe).
Source: "bundle\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist

[Run]
; 1) Instala o VC++ Redistributable silenciosamente (se estiver no bundle).
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; \
  StatusMsg: "Instalando componentes do Windows (VC++)…"; \
  Flags: waituntilterminated skipifdoesntexist
; 2) Roda o orquestrador com os dados coletados no wizard. Sem notepad, sem prompts.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\backend\edge\instalar-tudo.ps1"" -Raiz ""{app}\backend"" -Email ""{code:GetEmail}"" -Senha ""{code:GetSenha}"" -UnidadeId ""{code:GetUnidade}"" -LicensePublicKey ""{#MyLicensePubKey}"" -CloudApi ""{#MyCloudApi}"""; \
  StatusMsg: "Instalando o Regem Edge (Postgres, banco, certificado, servicos)…"; \
  Flags: runascurrentuser waituntilterminated

[Messages]
WelcomeLabel2=Este assistente instala o servidor local do Regem e configura tudo automaticamente. Voce so precisa entrar com a conta do C&O (a mesma do app) na proxima tela.

[Code]
var
  PgConta: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  PgConta := CreateInputQueryPage(wpWelcome,
    'Entrar com a conta C&O',
    'Use o e-mail e a senha da conta do Regem (a mesma do app).',
    'A ativacao e feita automaticamente pela nuvem. O ID da unidade e opcional (so preencha se a empresa tiver mais de uma loja).');
  PgConta.Add('E-mail do C&O:', False);
  PgConta.Add('Senha:', True);
  PgConta.Add('ID da unidade (opcional):', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PgConta.ID then
  begin
    if Trim(PgConta.Values[0]) = '' then
    begin
      MsgBox('Informe o e-mail do C&O.', mbError, MB_OK); Result := False; Exit;
    end;
    if PgConta.Values[1] = '' then
    begin
      MsgBox('Informe a senha.', mbError, MB_OK); Result := False; Exit;
    end;
  end;
end;

function GetEmail(Param: string): string;
begin Result := Trim(PgConta.Values[0]); end;
function GetSenha(Param: string): string;
begin Result := PgConta.Values[1]; end;
function GetUnidade(Param: string): string;
begin Result := Trim(PgConta.Values[2]); end;
