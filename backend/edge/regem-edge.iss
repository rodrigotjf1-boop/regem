; Regem Edge — instalador de UM CLIQUE (Inno Setup 6+).
; Compile no Windows com o Inno Setup (https://jrsoftware.org/isdl.php).
;
; O instalador faz TODO o local automaticamente (Postgres/Node embutidos, banco,
; senha, certificado, servicos, migrations, confiar o ca.pem). Na tela ele so pede a
; conta C&O - e, ANTES de copiar qualquer arquivo, resolve com a nuvem a loja (empresa
; com mais de uma) e o codigo de seguranca (loja que ja tem servidor em outro
; computador). A conversa com a nuvem fica em assistente-nuvem.iss (#include).
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
#define AppVer  "1.19.0"
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
  Parameters: "-ExecutionPolicy Bypass -NoProfile -File ""{app}\backend\edge\instalar-tudo.ps1"" -Raiz ""{app}\backend"" -Modo ""{code:GetModo}"" -ServidorHost ""{code:GetServidorHost}"" -CredFile ""{tmp}\regem-cred.txt"" -LicensePublicKey ""{#MyLicensePubKey}"" -CloudApi ""{#MyCloudApi}"" -Limpar"; \
  StatusMsg: "Instalando o Regem Edge…"; \
  Flags: waituntilterminated

[Messages]
WelcomeLabel2=Este assistente instala o Regem local e configura tudo automaticamente. Na proxima tela voce escolhe se este PC e o Servidor (cerebro da loja) ou um Cliente (so abre o app apontando pro Servidor).

[Code]
#include "assistente-nuvem.iss"

var
  PgModo: TInputOptionWizardPage;     // Servidor x Cliente
  PgConta: TInputQueryWizardPage;     // conta C&O (so no Servidor)
  PgLoja: TInputOptionWizardPage;     // loja deste servidor (so empresa com mais de uma)
  PgCodigo: TInputQueryWizardPage;    // codigo da trava (so loja com servidor em OUTRO computador)
  PgServidor: TInputQueryWizardPage;  // IP do Servidor (so no Cliente)
  LblCodigo: TNewStaticText;
  BtnReenviar: TNewButton;
  ChkTotp: TNewCheckBox;
  gUnidadeId: string;                 // loja escolhida (vai para o script no arquivo de credenciais)
  gPrecisaCodigo: Boolean;            // a nuvem pediu o codigo e ele ainda nao foi conferido
  gCodigoPedido: Boolean;             // o codigo ja foi pedido nesta tela
  gCodigoConferido: Boolean;
  gFalhou: Boolean;                   // o script terminou SEM o flag de sucesso?

function EhCliente: Boolean;
begin
  Result := (PgModo.SelectedValueIndex = 1);
end;

function EmailConta: string;
begin Result := Trim(PgConta.Values[0]); end;
function SenhaConta: string;
begin Result := PgConta.Values[1]; end;

// Pede o codigo (e-mail ou app autenticador) e diz na tela para onde foi.
procedure PedirCodigoNaTela;
var destino, erro, metodo: string;
begin
  if ChkTotp.Visible and ChkTotp.Checked then metodo := 'totp' else metodo := 'email';
  LblCodigo.Caption := 'Pedindo o codigo na nuvem...';
  WizardForm.Update;
  if PedirCodigo(EmailConta, SenhaConta, metodo, destino, erro) then
  begin
    gCodigoPedido := True;
    PgCodigo.Values[0] := '';
    if metodo = 'totp' then
      LblCodigo.Caption := 'Abra o app autenticador da conta (Google Authenticator, Authy) e digite o codigo de 6 digitos que ele mostra.'
    else
      LblCodigo.Caption := 'Enviamos um codigo de 6 digitos para ' + destino + '. Ele vale 10 minutos. ' +
        'Nao chegou? Olhe a caixa de spam ou clique em Reenviar codigo (vale sempre o e-mail mais recente).';
  end
  else
    LblCodigo.Caption := 'Nao consegui pedir o codigo: ' + erro;
end;

procedure ReenviarClick(Sender: TObject);
begin
  PedirCodigoNaTela;
end;

procedure TotpClick(Sender: TObject);
begin
  PedirCodigoNaTela;
end;

procedure InitializeWizard;
begin
  gApiNuvem := '{#MyCloudApi}';
  gFingerprint := FingerprintMaquina;

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
    'A ativacao e feita automaticamente pela nuvem. Antes de copiar qualquer arquivo, o instalador confere a conta e, se precisar, pede a loja e o codigo de seguranca.');
  PgConta.Add('E-mail do C&O:', False);
  PgConta.Add('Senha:', True);

  // Loja deste servidor — so quando a empresa tem mais de uma (a lista vem da nuvem). Antes era
  // uma pergunta na janela preta, no fim da instalacao.
  PgLoja := CreateInputOptionPage(PgConta.ID,
    'Loja deste servidor',
    'Em qual loja este computador vai ser o servidor?',
    'A empresa tem mais de uma loja. Escolha a loja onde este computador fica: cada loja tem o proprio cardapio, setores e configuracao.',
    True, True);

  // Codigo de seguranca — so quando a loja ja tem servidor em OUTRO computador (trava contra
  // clone). Pedido e conferido AQUI, antes de copiar: o codigo vale 10 minutos, e no fim da
  // instalacao ele vencia (ERR-124). O servidor so muda de computador no fim da instalacao.
  PgCodigo := CreateInputQueryPage(PgLoja.ID,
    'Codigo de seguranca',
    'Esta loja ja tem um servidor em outro computador',
    'Para mover o servidor para ESTE computador, digite o codigo de seguranca. O outro computador segue funcionando ate esta instalacao terminar; depois ele para de sincronizar.');
  PgCodigo.Add('Codigo de 6 digitos:', False);

  LblCodigo := TNewStaticText.Create(PgCodigo);
  LblCodigo.Parent := PgCodigo.Surface;
  LblCodigo.Top := PgCodigo.Edits[0].Top + PgCodigo.Edits[0].Height + ScaleY(10);
  LblCodigo.Width := PgCodigo.SurfaceWidth;
  LblCodigo.Height := ScaleY(48);
  LblCodigo.AutoSize := False;
  LblCodigo.WordWrap := True;
  LblCodigo.Caption := '';

  BtnReenviar := TNewButton.Create(PgCodigo);
  BtnReenviar.Parent := PgCodigo.Surface;
  BtnReenviar.Caption := 'Reenviar codigo';
  BtnReenviar.Top := LblCodigo.Top + LblCodigo.Height + ScaleY(6);
  BtnReenviar.Width := ScaleX(150);
  BtnReenviar.Height := ScaleY(23);
  BtnReenviar.OnClick := @ReenviarClick;

  ChkTotp := TNewCheckBox.Create(PgCodigo);
  ChkTotp.Parent := PgCodigo.Surface;
  ChkTotp.Caption := 'Usar o app autenticador em vez do e-mail';
  ChkTotp.Top := BtnReenviar.Top + BtnReenviar.Height + ScaleY(10);
  ChkTotp.Width := PgCodigo.SurfaceWidth;
  ChkTotp.Height := ScaleY(17);
  ChkTotp.Visible := False;
  ChkTotp.OnClick := @TotpClick;

  // Endereco do Servidor — so o Cliente precisa. Aceita NOME (regem.local, via mDNS)
  // ou IP. Vem pre-preenchido com regem.local: assim o operador nao lida com IP e
  // sobrevive a troca de IP pelo roteador. Se a rede nao resolver o nome, digita o IP.
  PgServidor := CreateInputQueryPage(PgCodigo.ID,
    'Endereco do Servidor',
    'Nome ou IP do Servidor Regem na rede local.',
    'Padrao "regem.local" (o Servidor se anuncia na rede). Se a rede nao encontrar por esse nome, troque pelo IP do PC Servidor (ex.: 192.168.0.10).');
  PgServidor.Add('Servidor (nome ou IP):', False);
  PgServidor.Values[0] := 'regem.local';
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  // Cliente nao usa a conta C&O, a loja nem o codigo; Servidor nao usa o IP do servidor.
  if PageID = PgConta.ID then Result := EhCliente;
  if PageID = PgLoja.ID then Result := EhCliente or (GetArrayLength(gUnidadesIds) = 0);
  if PageID = PgCodigo.ID then Result := EhCliente or (not gPrecisaCodigo) or gCodigoConferido;
  if PageID = PgServidor.ID then Result := not EhCliente;
end;

// Depois de cada consulta: a nuvem pediu o codigo e ele ainda nao foi conferido?
procedure GuardarSituacao;
begin
  gPrecisaCodigo := (gSituacao = 'codigo') and (not gJaConferido);
  gCodigoPedido := False;
  gCodigoConferido := False;
end;

procedure PreencherLojas;
var i: Integer; nome: string;
begin
  PgLoja.CheckListBox.Items.Clear;
  for i := 0 to GetArrayLength(gUnidadesIds) - 1 do
  begin
    nome := gUnidadesNomes[i];
    if gUnidadesMatriz[i] then nome := nome + ' (matriz)';
    PgLoja.Add(nome);
  end;
  if GetArrayLength(gUnidadesIds) > 0 then PgLoja.SelectedValueIndex := 0;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var erro, codigo: string;
begin
  Result := True;
  if (CurPageID = PgConta.ID) and (not EhCliente) then
  begin
    if EmailConta = '' then
    begin
      MsgBox('Informe o e-mail do C&O.', mbError, MB_OK); Result := False; Exit;
    end;
    if SenhaConta = '' then
    begin
      MsgBox('Informe a senha.', mbError, MB_OK); Result := False; Exit;
    end;
    // Conta (ou senha) nova: esquece a loja e o codigo decididos antes.
    gUnidadeId := '';
    SetArrayLength(gUnidadesIds, 0);
    WizardForm.Update;
    // Tudo com a nuvem ANTES de copiar: login, loja e a trava de outro computador (ERR-124).
    if not ConsultarInstalacao(EmailConta, SenhaConta, '', erro) then
    begin
      MsgBox(erro, mbError, MB_OK); Result := False; Exit;
    end;
    if gSituacao = 'antiga' then
    begin
      // Nuvem ainda sem o assistente: confere so o login, como antes; a loja e o codigo ficam
      // para a janela da instalacao.
      erro := ValidaLoginNuvem(EmailConta, SenhaConta);
      if erro <> '' then
      begin
        MsgBox(erro, mbError, MB_OK); Result := False; Exit;
      end;
    end;
    if gSituacao = 'escolher_loja' then PreencherLojas;
    GuardarSituacao;
  end;
  if (CurPageID = PgLoja.ID) and (not EhCliente) then
  begin
    if PgLoja.SelectedValueIndex < 0 then
    begin
      MsgBox('Escolha a loja deste servidor.', mbError, MB_OK); Result := False; Exit;
    end;
    gUnidadeId := gUnidadesIds[PgLoja.SelectedValueIndex];
    WizardForm.Update;
    // Com a loja escolhida, a nuvem diz se esta maquina precisa do codigo.
    if not ConsultarInstalacao(EmailConta, SenhaConta, gUnidadeId, erro) then
    begin
      MsgBox(erro, mbError, MB_OK); Result := False; Exit;
    end;
    GuardarSituacao;
  end;
  if (CurPageID = PgCodigo.ID) and (not EhCliente) then
  begin
    codigo := Trim(PgCodigo.Values[0]);
    if Length(codigo) <> 6 then
    begin
      MsgBox('Digite o codigo de 6 digitos.', mbError, MB_OK); Result := False; Exit;
    end;
    LblCodigo.Caption := 'Conferindo o codigo...';
    WizardForm.Update;
    if ConferirCodigo(EmailConta, SenhaConta, codigo, erro) then
    begin
      gCodigoConferido := True;
      LblCodigo.Caption := 'Codigo conferido. O servidor muda para este computador no fim da instalacao.';
    end
    else
    begin
      LblCodigo.Caption := erro;
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
begin Result := EmailConta; end;
function GetSenha(Param: string): string;
begin Result := SenhaConta; end;
function GetUnidade(Param: string): string;
begin Result := gUnidadeId; end;

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

// O motivo que o script deixou em ULTIMO-ERRO.txt (UTF-8: a frase da nuvem vem com acento).
function LerUltimoErro(const arquivo: string): string;
var linhas: TArrayOfString; i: Integer;
begin
  Result := '';
  if not LoadStringsFromFile(arquivo, linhas) then Exit;
  for i := 0 to GetArrayLength(linhas) - 1 do
  begin
    if Result <> '' then Result := Result + #13#10;
    Result := Result + linhas[i];
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var s, err: string;
begin
  if CurStep = ssInstall then
  begin
    // 1) Libera os arquivos travados (reinstalacao) ANTES da copia.
    PararServicosRegem;
    // 2) So o Servidor grava a credencial C&O (o Cliente nao provisiona). Linhas: e-mail, senha,
    //    loja escolhida e a identificacao desta maquina calculada aqui (o script confere se bate
    //    com a dele: o codigo conferido no assistente vale para ESTA maquina).
    if not EhCliente then
    begin
      s := EmailConta + #13#10 + SenhaConta + #13#10 + gUnidadeId + #13#10 + gFingerprint;
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
      err := LerUltimoErro(ExpandConstant('{app}\backend\logs\ULTIMO-ERRO.txt'));
      if err = '' then err := ExpandConstant('A instalacao nao foi concluida. Veja o log em {app}\backend\logs.');
      MsgBox('A instalacao NAO foi concluida:' + #13#10#13#10 + err + #13#10#13#10 + 'A instalacao parou antes de terminar. Corrija e rode o instalador de novo.', mbCriticalError, MB_OK);
    end;
  end;
end;

// Tela do codigo: pede o codigo ao chegar (uma vez; "Reenviar codigo" pede outro).
// Tela final: reflete a falha (o Inno mostraria "concluido" mesmo assim).
procedure CurPageChanged(CurPageID: Integer);
begin
  if (CurPageID = PgCodigo.ID) and (not gCodigoPedido) then
  begin
    // Marcar a caixa por codigo dispara o OnClick (pediria o codigo duas vezes): solta antes.
    ChkTotp.OnClick := nil;
    ChkTotp.Visible := gTemTotp;
    ChkTotp.Checked := gTemTotp and (gMetodoPreferido = 'totp');
    ChkTotp.OnClick := @TotpClick;
    PedirCodigoNaTela;
  end;
  if (CurPageID = wpFinished) and gFalhou then
  begin
    WizardForm.FinishedHeadingLabel.Caption := 'Instalacao NAO concluida';
    WizardForm.FinishedLabel.Caption := 'A instalacao nao terminou (veja a mensagem que apareceu). Corrija os dados e rode o instalador de novo.';
  end;
end;
