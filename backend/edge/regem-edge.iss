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
#define AppVer  "1.2.0"
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
; So instala em Windows 64-bit (os binarios embutidos Postgres/Node sao x64) e roda o
; instalador em modo 64-bit (sem redirecionamento WOW64 -> {sys} = System32 real).
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Files]
; App (gerado por edge/package.mjs) -> {app}\backend
Source: "..\..\regem-edge-dist\*"; DestDir: "{app}\backend"; Flags: recursesubdirs createallsubdirs
; Binarios portateis EMBUTIDOS (opcionais) — se a pasta existir, sao empacotados:
Source: "bundle\node\*";  DestDir: "{app}\node";  Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
; Postgres: SO o que o servidor precisa (bin/lib/share). Exclui pgAdmin 4,
; StackBuilder, doc, include, symbols — inuteis e pesados (pgAdmin gerava o erro
; de ucrtbase.dll na extracao). Deixa o .exe bem menor.
Source: "bundle\pgsql\bin\*";   DestDir: "{app}\pgsql\bin";   Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "bundle\pgsql\lib\*";   DestDir: "{app}\pgsql\lib";   Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "bundle\pgsql\share\*"; DestDir: "{app}\pgsql\share"; Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
Source: "bundle\nssm\*";  DestDir: "{app}\nssm";  Flags: recursesubdirs createallsubdirs skipifsourcedoesntexist
; Runtime do Windows (VC++ x64) — o Postgres embutido precisa dele. Coloque em
; edge\bundle\vc_redist.x64.exe (baixe: https://aka.ms/vs/17/release/vc_redist.x64.exe).
Source: "bundle\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist

[Run]
; 1) Instala o VC++ Redistributable silenciosamente (se estiver no bundle).
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; \
  StatusMsg: "Instalando componentes do Windows (VC++)…"; \
  Flags: waituntilterminated skipifdoesntexist
; 2) Roda o orquestrador. As credenciais NAO vao na linha de comando (o transcript
;    do PowerShell gravaria a senha no log) — vao num arquivo temporario que o
;    [Code] escreve antes e o script le e apaga. So o CAMINHO aparece aqui.
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\backend\edge\instalar-tudo.ps1"" -Raiz ""{app}\backend"" -Modo ""{code:GetModo}"" -ServidorHost ""{code:GetServidorHost}"" -CredFile ""{tmp}\regem-cred.txt"" -LicensePublicKey ""{#MyLicensePubKey}"" -CloudApi ""{#MyCloudApi}"""; \
  StatusMsg: "Instalando o Regem Edge…"; \
  Flags: waituntilterminated

[Messages]
WelcomeLabel2=Este assistente instala o Regem local e configura tudo automaticamente. Na proxima tela voce escolhe se este PC e o Servidor (cerebro da loja) ou um Cliente (so abre o app apontando pro Servidor).

[Code]
var
  PgModo: TInputOptionWizardPage;     // Servidor x Cliente
  PgConta: TInputQueryWizardPage;     // conta C&O (so no Servidor)
  PgServidor: TInputQueryWizardPage;  // IP do Servidor (so no Cliente)
  gFalhou: Boolean;                   // o script terminou SEM o flag de sucesso?

function EhCliente: Boolean;
begin
  Result := (PgModo.SelectedValueIndex = 1);
end;

procedure InitializeWizard;
begin
  // Tipo de instalacao: Servidor (cerebro da loja) ou Cliente (casca que aponta pro
  // Servidor na LAN). Um Servidor por loja; os demais PCs sao Clientes.
  PgModo := CreateInputOptionPage(wpWelcome,
    'Tipo de instalacao',
    'Este computador e o Servidor ou um Cliente?',
    'O SERVIDOR e o cerebro da loja (banco de dados + servicos) — instale em UM computador. Os demais sao CLIENTES: so abrem o app apontando para o Servidor na rede.',
    True, False);
  PgModo.Add('Servidor (cerebro da loja) — instalar tudo aqui');
  PgModo.Add('Cliente (so abre o app apontando pro Servidor)');
  PgModo.SelectedValueIndex := 0;

  // Conta C&O — so o Servidor provisiona/ativa a licenca.
  PgConta := CreateInputQueryPage(PgModo.ID,
    'Entrar com a conta C&O',
    'Use o e-mail e a senha da conta do Regem (a mesma do app).',
    'A ativacao e feita automaticamente pela nuvem. O ID da unidade e opcional (so preencha se a empresa tiver mais de uma loja).');
  PgConta.Add('E-mail do C&O:', False);
  PgConta.Add('Senha:', True);
  PgConta.Add('ID da unidade (opcional):', False);

  // Endereco do Servidor — so o Cliente precisa. Aceita NOME (regem.local, via mDNS)
  // ou IP. Vem pre-preenchido com regem.local: assim o operador nao lida com IP e
  // sobrevive a troca de IP pelo roteador. Se a rede nao resolver o nome, digita o IP.
  PgServidor := CreateInputQueryPage(PgConta.ID,
    'Endereco do Servidor',
    'Nome ou IP do Servidor Regem na rede local.',
    'Padrao "regem.local" (o Servidor se anuncia na rede). Se a rede nao encontrar por esse nome, troque pelo IP do PC Servidor (ex.: 192.168.0.10).');
  PgServidor.Add('Servidor (nome ou IP):', False);
  PgServidor.Values[0] := 'regem.local';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  // Cliente nao usa a conta C&O; Servidor nao usa o IP do servidor.
  if PageID = PgConta.ID then Result := EhCliente;
  if PageID = PgServidor.ID then Result := not EhCliente;
end;

// Escapa aspas/barra para montar o JSON do corpo com seguranca.
function EscapaJson(const s: string): string;
begin
  Result := s;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

// Valida o login C&O na nuvem AQUI (no Avancar da tela de conta), ANTES de copiar
// qualquer arquivo — falha rapido, sem instalar nada. '' = ok; senao a mensagem.
function ValidaLoginNuvem(const email, senha: string): string;
var http: Variant; body: string; st: Integer;
begin
  Result := '';
  try
    http := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    http.SetTimeouts(8000, 8000, 8000, 15000); // resolve, connect, send, receive (ms)
    http.Open('POST', '{#MyCloudApi}/auth/login', False);
    http.SetRequestHeader('Content-Type', 'application/json');
    body := '{"email":"' + EscapaJson(email) + '","senha":"' + EscapaJson(senha) + '"}';
    http.Send(body);
    st := http.Status;
    if st = 401 then
      Result := 'E-mail ou senha invalidos. Confira os dados do C&O e tente de novo.'
    else if (st < 200) or (st >= 300) then
      Result := 'Nao consegui validar o login (codigo ' + IntToStr(st) + '). Tente de novo.';
  except
    Result := 'Nao consegui validar o login na nuvem. A loja esta com internet? Detalhe: ' + GetExceptionMessage;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var erro: string;
begin
  Result := True;
  if (CurPageID = PgConta.ID) and (not EhCliente) then
  begin
    if Trim(PgConta.Values[0]) = '' then
    begin
      MsgBox('Informe o e-mail do C&O.', mbError, MB_OK); Result := False; Exit;
    end;
    if PgConta.Values[1] = '' then
    begin
      MsgBox('Informe a senha.', mbError, MB_OK); Result := False; Exit;
    end;
    // Autorização ANTES de avançar: sem login válido, não instala nada.
    WizardForm.Update;
    erro := ValidaLoginNuvem(Trim(PgConta.Values[0]), PgConta.Values[1]);
    if erro <> '' then
    begin
      MsgBox(erro, mbError, MB_OK); Result := False; Exit;
    end;
  end;
  if (CurPageID = PgServidor.ID) and EhCliente then
  begin
    if Trim(PgServidor.Values[0]) = '' then
    begin
      MsgBox('Informe o IP do Servidor Regem na rede.', mbError, MB_OK); Result := False; Exit;
    end;
  end;
end;

function GetModo(Param: string): string;
begin
  if EhCliente then Result := 'cliente' else Result := 'servidor';
end;
function GetServidorHost(Param: string): string;
begin Result := Trim(PgServidor.Values[0]); end;
function GetEmail(Param: string): string;
begin Result := Trim(PgConta.Values[0]); end;
function GetSenha(Param: string): string;
begin Result := PgConta.Values[1]; end;
function GetUnidade(Param: string): string;
begin Result := Trim(PgConta.Values[2]); end;

// Escreve as credenciais num arquivo temporario (fora da linha de comando) logo
// antes do [Run]. O {tmp} e apagado pelo Inno no fim; o script tambem remove o
// arquivo assim que le. Evita que a senha do C&O apareca no transcript/log.
// Reinstalacao: para os servicos do Regem ANTES de copiar os arquivos — senao os
// executaveis/scripts em uso (RegemEdgeApi/Web/Sync/Pg...) travam a substituicao e a
// instalacao fica incompleta (arquivos faltando). net stop de servico inexistente e no-op.
procedure PararServicosRegem;
var rc, i: Integer; nomes: array[0..4] of string;
begin
  nomes[0] := 'RegemEdgeWeb'; nomes[1] := 'RegemEdgeApi'; nomes[2] := 'RegemEdgeSync';
  nomes[3] := 'RegemEdgeImpressao'; nomes[4] := 'RegemEdgePg';
  for i := 0 to 4 do
    Exec(ExpandConstant('{sys}\net.exe'), 'stop ' + nomes[i] + ' /y', '', SW_HIDE, ewWaitUntilTerminated, rc);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var s: string; err: AnsiString;
begin
  if CurStep = ssInstall then
  begin
    // 1) Libera os arquivos travados (reinstalacao) ANTES da copia.
    PararServicosRegem;
    // 2) So o Servidor grava a credencial C&O (o Cliente nao provisiona).
    if not EhCliente then
    begin
      s := Trim(PgConta.Values[0]) + #13#10 + PgConta.Values[1] + #13#10 + Trim(PgConta.Values[2]);
      SaveStringToFile(ExpandConstant('{tmp}\regem-cred.txt'), s, False);
    end;
  end;
  // Depois do script: SEM o flag de sucesso = falhou (login errado, sem internet,
  // Postgres, migrations...). Avisa claro e marca para a tela final refletir.
  if CurStep = ssPostInstall then
  begin
    if not FileExists(ExpandConstant('{app}\backend\logs\INSTALOU-OK.flag')) then
    begin
      gFalhou := True;
      if not LoadStringFromFile(ExpandConstant('{app}\backend\logs\ULTIMO-ERRO.txt'), err) then
        err := 'A instalacao nao foi concluida. Veja o log em {app}\backend\logs.';
      MsgBox('A instalacao NAO foi concluida:' + #13#10#13#10 + String(err) + #13#10#13#10 + 'Nada ficou configurado. Corrija e rode o instalador de novo.', mbCriticalError, MB_OK);
    end;
  end;
end;

// Tela final reflete a falha (o Inno mostraria "concluido" mesmo assim).
procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = wpFinished) and gFalhou then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Instalacao NAO concluida';
    WizardForm.FinishedLabel.Caption := 'Houve um erro e o Regem Edge NAO foi instalado (veja a mensagem que apareceu). Corrija os dados e rode o instalador de novo.';
  end;
end;
