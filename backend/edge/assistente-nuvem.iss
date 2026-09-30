// Regem Edge - conversa do ASSISTENTE do instalador com a nuvem (ERR-124).
// Incluido no [Code] do regem-edge.iss (#include). Sem tela aqui: as paginas do assistente usam
// estas funcoes, e o teste (testes\assistente-nuvem.teste.iss) as chama contra uma nuvem falsa.
//
// Por que existe: o codigo da trava (loja com servidor em OUTRO computador) era pedido so no fim
// do script, depois de copiar os arquivos e subir os dados antigos da maquina - 14 min na loja em
// 29/09 -, e o codigo de 10 minutos vencia com o dono longe da tela. Agora o assistente pergunta
// tudo ANTES de copiar: /provisionamento/verificar diz o que esta maquina vai encontrar (pronto,
// escolher a loja ou o codigo), e /provisionamento/reautorizar/verificar confere o codigo SEM
// mover o servidor - o move fica para o fim da instalacao.
//
// Textos em ASCII (o arquivo e lido sem BOM); a frase da nuvem chega com acento e aparece inteira.

var
  gApiNuvem: string;        // a MyCloudApi do regem-edge.iss; no teste, a nuvem falsa
  gFingerprint: string;     // identificacao desta maquina (MESMO calculo do instalar-tudo.ps1 e do sync-daemon)
  gSituacao: string;        // pronto | escolher_loja | codigo | antiga (nuvem sem o assistente)
  gMetodoPreferido: string; // email | totp
  gTemTotp: Boolean;
  gJaConferido: Boolean;    // o codigo desta maquina ja foi conferido (janela de 2 h)
  gUnidadesIds: array of string;
  gUnidadesNomes: array of string;
  gUnidadesMatriz: array of Boolean;

// Escapa aspas/barra para montar o JSON do corpo com seguranca.
function EscapaJson(const s: string): string;
begin
  Result := s;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

// sha256 (hex minusculo) do MachineGuid em MAIUSCULAS, lido na visao 64-bit do registro - o mesmo
// FingerprintForte do instalar-tudo.ps1 e o fingerprintForte() do sync-daemon.mjs. Sem o
// MachineGuid, o nome do computador (o mesmo fallback dos dois).
function FingerprintMaquina: string;
var guid: string;
begin
  Result := '';
  if RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\Cryptography', 'MachineGuid', guid) and (Trim(guid) <> '') then
    Result := LowerCase(GetSHA256OfString(Uppercase(guid)))
  else
    Result := GetComputerNameString;
end;

// Valor TEXTO de "chave":"valor" no JSON da nuvem ('' se nao houver). O JSON do Nest vem sem
// espacos entre chave e valor; acentos chegam crus (UTF-8 ja decodificado pelo WinHttp).
function JsonTexto(const json, chave: string): string;
var p, i, n: Integer; c, hex: string;
begin
  Result := '';
  p := Pos('"' + chave + '":"', json);
  if p = 0 then Exit;
  i := p + Length(chave) + 4;
  n := Length(json);
  while i <= n do
  begin
    c := Copy(json, i, 1);
    if c = '"' then Break;
    if (c = '\') and (i < n) then
    begin
      i := i + 1;
      c := Copy(json, i, 1);
      if c = 'n' then Result := Result + #13#10
      else if (c = 'r') or (c = 't') then Result := Result + ' '
      else if (c = 'u') and (i + 4 <= n) then
      begin
        hex := Copy(json, i + 1, 4);
        Result := Result + Chr(StrToIntDef('$' + hex, 63));
        i := i + 4;
      end
      else Result := Result + c;
    end
    else Result := Result + c;
    i := i + 1;
  end;
end;

function JsonVerdadeiro(const json, chave: string): Boolean;
begin
  Result := Pos('"' + chave + '":true', json) > 0;
end;

// A lista de lojas de {"unidades":[{"id":"..","nome":"..","matriz":true},...]}. A nuvem monta cada
// objeto com as chaves NESTA ordem (licenca.service, verificarInstalacao); aspas dentro de um nome
// vem escapadas, entao '"matriz":' so aparece como chave.
procedure LerUnidades(const json: string);
var resto, obj: string; p, fim, n: Integer;
begin
  SetArrayLength(gUnidadesIds, 0);
  SetArrayLength(gUnidadesNomes, 0);
  SetArrayLength(gUnidadesMatriz, 0);
  p := Pos('"unidades":[', json);
  if p = 0 then Exit;
  resto := Copy(json, p + 12, Length(json));
  n := 0;
  while True do
  begin
    p := Pos('{"id":"', resto);
    if p = 0 then Break;
    resto := Copy(resto, p, Length(resto));
    fim := Pos('"matriz":', resto);
    if fim = 0 then Break;
    obj := Copy(resto, 1, fim + 14);
    SetArrayLength(gUnidadesIds, n + 1);
    SetArrayLength(gUnidadesNomes, n + 1);
    SetArrayLength(gUnidadesMatriz, n + 1);
    gUnidadesIds[n] := JsonTexto(obj, 'id');
    gUnidadesNomes[n] := JsonTexto(obj, 'nome');
    gUnidadesMatriz[n] := Pos('"matriz":true', obj) > 0;
    n := n + 1;
    resto := Copy(resto, fim + 9, Length(resto));
  end;
end;

// POST JSON na nuvem. Devolve o status HTTP (0 = sem resposta: sem internet, DNS, tempo) e o corpo
// da resposta em `resposta` (no status 0, a mensagem do erro).
function PostNuvem(const rota, corpo: string; var resposta: string): Integer;
var http: Variant;
begin
  Result := 0;
  resposta := '';
  try
    http := CreateOleObject('WinHttp.WinHttpRequest.5.1');
    http.SetTimeouts(8000, 8000, 8000, 30000); // resolve, connect, send, receive (ms)
    http.Open('POST', gApiNuvem + rota, False);
    http.SetRequestHeader('Content-Type', 'application/json; charset=utf-8');
    http.Send(corpo);
    Result := http.Status;
    resposta := http.ResponseText;
  except
    resposta := GetExceptionMessage;
  end;
end;

// A frase da nuvem ("Codigo expirado...") em vez de um codigo HTTP.
function MensagemDaNuvem(status: Integer; const resposta: string): string;
begin
  Result := JsonTexto(resposta, 'message');
  if Result <> '' then Exit;
  if status = 0 then
    Result := 'Nao consegui falar com a nuvem. A loja esta com internet? Detalhe: ' + resposta
  else
    Result := 'A nuvem respondeu com o codigo ' + IntToStr(status) + '. Tente de novo.';
end;

function CampoJson(const chave, valor: string): string;
begin
  Result := ',"' + chave + '":"' + EscapaJson(valor) + '"';
end;

// Corpo das rotas de provisionamento: a conta C&O + esta maquina (+ o que vier em `extra`).
function CorpoDaConta(const email, senha, extra: string): string;
begin
  Result := '{"email":"' + EscapaJson(email) + '"' + CampoJson('senha', senha) +
    CampoJson('fingerprint', gFingerprint) + extra + '}';
end;

// Confere so o login (nuvem antiga, sem o assistente). '' = ok; senao a mensagem.
function ValidaLoginNuvem(const email, senha: string): string;
var st: Integer; resp: string;
begin
  Result := '';
  st := PostNuvem('/auth/login', '{"email":"' + EscapaJson(email) + '"' + CampoJson('senha', senha) + '}', resp);
  if st = 401 then
    Result := 'E-mail ou senha invalidos. Confira os dados do C&O e tente de novo.'
  else if (st < 200) or (st >= 300) then
    Result := MensagemDaNuvem(st, resp);
end;

// O que esta maquina vai encontrar na nuvem, SEM efeito nenhum. True = respondeu (gSituacao e o
// resto preenchidos); False = erro, com a frase em `erro`. Nuvem sem a rota (antes do deploy):
// gSituacao = 'antiga' e o assistente segue como antes (o script pergunta loja e codigo).
function ConsultarInstalacao(const email, senha, unidadeId: string; var erro: string): Boolean;
var st: Integer; resp, extra: string;
begin
  Result := False;
  erro := '';
  gSituacao := '';
  gMetodoPreferido := 'email';
  gTemTotp := False;
  gJaConferido := False;
  extra := '';
  if unidadeId <> '' then extra := CampoJson('unidadeId', unidadeId);
  st := PostNuvem('/provisionamento/verificar', CorpoDaConta(email, senha, extra), resp);
  if st = 404 then
  begin
    gSituacao := 'antiga';
    Result := True;
    Exit;
  end;
  if (st < 200) or (st >= 300) then
  begin
    erro := MensagemDaNuvem(st, resp);
    Exit;
  end;
  gSituacao := JsonTexto(resp, 'situacao');
  if JsonTexto(resp, 'metodoPreferido') <> '' then gMetodoPreferido := JsonTexto(resp, 'metodoPreferido');
  gTemTotp := JsonVerdadeiro(resp, 'temTotp');
  gJaConferido := JsonVerdadeiro(resp, 'jaConferido');
  if gSituacao = 'escolher_loja' then LerUnidades(resp);
  Result := (gSituacao = 'pronto') or (gSituacao = 'codigo') or
    ((gSituacao = 'escolher_loja') and (GetArrayLength(gUnidadesIds) > 0));
  if not Result then erro := 'A nuvem respondeu algo que o instalador nao entendeu. Tente de novo.';
end;

// Pede o codigo da trava (e-mail: a nuvem manda; totp: o dono le do app). `destino` = e-mail mascarado.
function PedirCodigo(const email, senha, metodo: string; var destino, erro: string): Boolean;
var st: Integer; resp: string;
begin
  destino := '';
  erro := '';
  st := PostNuvem('/provisionamento/reautorizar/solicitar', CorpoDaConta(email, senha, CampoJson('metodo', metodo)), resp);
  Result := (st >= 200) and (st < 300);
  if Result then destino := JsonTexto(resp, 'destino') else erro := MensagemDaNuvem(st, resp);
end;

// Confere o codigo SEM mover o servidor (o move e no fim da instalacao).
function ConferirCodigo(const email, senha, codigo: string; var erro: string): Boolean;
var st: Integer; resp: string;
begin
  erro := '';
  st := PostNuvem('/provisionamento/reautorizar/verificar', CorpoDaConta(email, senha, CampoJson('codigo', codigo)), resp);
  Result := (st >= 200) and (st < 300);
  if not Result then erro := MensagemDaNuvem(st, resp);
end;
