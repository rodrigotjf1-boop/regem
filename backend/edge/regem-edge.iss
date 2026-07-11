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
#define MyLicensePubKey "COLE_AQUI_A_CHAVE_PUBLICA_B64"   ; (nao e segredo — a mesma para todas as lojas)

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

[Run]
; Roda o orquestrador com os dados coletados no wizard. Sem notepad, sem prompts.
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\backend\edge\instalar-tudo.ps1"" -Raiz ""{app}\backend"" -UnidadeId ""{code:GetUnidade}"" -SyncToken ""{code:GetSync}"" -AtivacaoToken ""{code:GetAtiv}"" -LicensePublicKey ""{#MyLicensePubKey}"" -CloudApi ""{#MyCloudApi}"""; \
  StatusMsg: "Instalando o Regem Edge (Postgres, banco, certificado, servicos)…"; \
  Flags: runascurrentuser waituntilterminated

[Messages]
WelcomeLabel2=Este assistente instala o servidor local do Regem e configura tudo automaticamente. Voce so precisa informar os dados desta loja (vindos do painel Regem) na proxima tela.

[Code]
var
  PgNuvem: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  PgNuvem := CreateInputQueryPage(wpWelcome,
    'Dados desta loja (nuvem)',
    'Informe os 3 dados abaixo — o resto e automatico.',
    'Pegue no Regem da nuvem: o ID da unidade e o token em Cadastros > Equipamentos (tipo servidor_local); o token de licenca em /frota.');
  PgNuvem.Add('ID da unidade (loja):', False);
  PgNuvem.Add('Token do servidor local (sync):', False);
  PgNuvem.Add('Token de ativacao da licenca (opcional):', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = PgNuvem.ID then
  begin
    if Trim(PgNuvem.Values[0]) = '' then
    begin
      MsgBox('Informe o ID da unidade (loja).', mbError, MB_OK); Result := False; Exit;
    end;
    if Trim(PgNuvem.Values[1]) = '' then
    begin
      MsgBox('Informe o token do servidor local (sync).', mbError, MB_OK); Result := False; Exit;
    end;
  end;
end;

function GetUnidade(Param: string): string;
begin Result := Trim(PgNuvem.Values[0]); end;
function GetSync(Param: string): string;
begin Result := Trim(PgNuvem.Values[1]); end;
function GetAtiv(Param: string): string;
begin Result := Trim(PgNuvem.Values[2]); end;
