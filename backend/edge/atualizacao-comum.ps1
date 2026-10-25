# Regem Edge - funcoes COMUNS da atualizacao (atualizar.ps1) e do rollback (reverter.ps1).
# Uso (no topo do script):   . (Join-Path $PSScriptRoot 'atualizacao-comum.ps1')
# Antes de usar, o script define: $script:Raiz, $script:log, $script:statusFile.
#
# ASCII puro de proposito: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
#
# Modelo (o mesmo do Velopack/Squirrel e das atualizacoes A/B do Android): a versao nova e
# MONTADA INTEIRA numa pasta ao lado, sem tocar na que esta rodando; a troca e so RENOMEAR
# pastas no mesmo disco (rapido e reversivel); voltar e renomear de novo. Nada de copiar
# arquivo a arquivo nem baixar dependencia no meio da troca (ERR-045, ERR-047).

# Tudo o que muda de uma versao para outra - trocado e voltado JUNTO.
$script:ItensDaVersao = @('dist', 'node_modules', 'web', 'scripts', 'database',
  'package.json', 'package-lock.json', 'dist-manifest.json', 'version.txt')
$script:Servicos = @('RegemEdgeApi', 'RegemEdgeSync', 'RegemEdgeImpressao', 'RegemEdgeWeb')
# Ferramentas da DISTRIBUICAO que versoes antigas deixaram no PC da loja (ERR-053).
$script:FerramentasDistribuicao = @('publicar.ps1', 'sign-update.mjs', 'gerar-ca-assinatura.mjs',
  'build-release.ps1', 'package.mjs', 'preflight-release.mjs', 'build-web.mjs', 'regem-edge.iss',
  'update-priv.pem', 'COMPILAR-INSTALADOR.md', 'PASSO-A-PASSO.md', 'ATUALIZAR.md', 'README.md')

$script:Utf8SemBom = New-Object System.Text.UTF8Encoding($false)

function Diga($m) {
  $l = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m
  Write-Host $l
  try { Add-Content -Path $script:log -Value $l } catch {}
}

# Status para a tela Servidor. SEM BOM: com BOM o JSON.parse da API falhava e a barra de
# progresso nunca aparecia (ERR-055).
function Grava-Status($obj) {
  try {
    $obj['ts'] = (Get-Date -Format o)
    [System.IO.File]::WriteAllText($script:statusFile, ($obj | ConvertTo-Json -Compress), $script:Utf8SemBom)
  } catch {}
}

function Ler-Env($envFile) {
  $cfg = @{}
  foreach ($linha in [System.IO.File]::ReadAllLines($envFile)) {
    if ($linha -match '^\s*#') { continue }
    if ($linha -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
  }
  foreach ($k in @('EDGE_DATABASE_URL', 'DATABASE_URL', 'SYNC_TOKEN', 'JWT_SECRET')) {
    if ($cfg.ContainsKey($k)) { $cfg[$k] = DecDpapi $cfg[$k] }
  }
  return $cfg
}

function DecDpapi($v) {
  if (-not $v -or -not $v.StartsWith('enc:')) { return $v }
  try {
    Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
      [Convert]::FromBase64String($v.Substring(4)), $null,
      [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    return [System.Text.Encoding]::UTF8.GetString($dec)
  } catch { Diga "(aviso) nao decifrei um segredo DPAPI: $($_.Exception.Message)"; return $v }
}

# APP_VERSION acompanha o CODIGO que esta no ar (ERR-047: o rollback deixava a versao nova).
function Grava-AppVersion($envFile, $versao) {
  $linhas = [System.Collections.Generic.List[string]]([System.IO.File]::ReadAllLines($envFile))
  $achou = $false
  for ($i = 0; $i -lt $linhas.Count; $i++) {
    if ($linhas[$i] -match '^\s*APP_VERSION\s*=') { $linhas[$i] = "APP_VERSION=$versao"; $achou = $true }
  }
  if (-not $achou) { $linhas.Add("APP_VERSION=$versao") }
  [System.IO.File]::WriteAllLines($envFile, $linhas, $script:Utf8SemBom)
}

# Trava entre atualizar.ps1 e reverter.ps1: arquivo aberto com acesso EXCLUSIVO enquanto o
# script roda. O Windows solta sozinho se o processo morrer - nunca fica presa.
function Obter-Trava($caminho) {
  try { return [System.IO.File]::Open($caminho, 'OpenOrCreate', 'ReadWrite', 'None') } catch { return $null }
}

function Svc($acao, $nome) {
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $script:nssmExe $acao $nome 2>&1 | Out-Null } catch {}
  $ErrorActionPreference = $ea
}

# Para os DEPENDENTES primeiro e o Api por ultimo, e ESPERA pararem de verdade (uma pasta com
# arquivo aberto nao pode ser renomeada).
function Parar-Servicos {
  foreach ($s in @('RegemEdgeWeb', 'RegemEdgeImpressao', 'RegemEdgeSync', 'RegemEdgeApi')) { Svc stop $s }
  foreach ($s in $script:Servicos) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc) {
      try { $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45)) }
      catch { Diga "(aviso) $s nao parou em 45s (estado: $($svc.Status))." }
    }
  }
  Start-Sleep -Seconds 2
}

function Subir-Servicos {
  foreach ($s in @('RegemEdgeApi', 'RegemEdgeSync', 'RegemEdgeImpressao', 'RegemEdgeWeb')) { Svc start $s }
}

# Renomeia (mesmo disco = instantaneo). Tenta 5x: antivirus/indexador seguram arquivo por
# alguns segundos. Destino NAO pode existir.
function Mover($de, $para) {
  for ($i = 1; $i -le 5; $i++) {
    try {
      if (Test-Path -LiteralPath $de -PathType Container) { [System.IO.Directory]::Move($de, $para) }
      else { [System.IO.File]::Move($de, $para) }
      return
    } catch {
      if ($i -eq 5) { throw "nao consegui mover '$de' para '$para': $($_.Exception.Message)" }
      Start-Sleep -Seconds 2
    }
  }
}

# Apaga pasta com caminhos longos (node_modules do next passa de 260) - o Remove-Item do
# PS 5.1 falha nesses; o rd com prefixo \\?\ nao.
function Apagar-Pasta($p) {
  if (-not (Test-Path -LiteralPath $p)) { return }
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & cmd.exe /c "rd /s /q `"\\?\$p`"" 2>&1 | Out-Null } catch {}
  $ErrorActionPreference = $ea
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
}

# Mantem as N pastas mais novas que casam com o filtro (backup-*, revertido-*, falhou-*).
function Podar($raiz, $filtro, $manter) {
  Get-ChildItem -LiteralPath $raiz -Directory -Filter $filtro -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -Skip $manter |
    ForEach-Object { Diga "Limpando $($_.Name)"; Apagar-Pasta $_.FullName }
}

# Roda o node com prazo (uma etapa travada nao prende a atualizacao para sempre).
function Rodar-Node($argumentos, $minutos, $cwd, $nome) {
  $out = Join-Path $script:logDir ("$nome.out.log")
  $err = Join-Path $script:logDir ("$nome.err.log")
  # Start-Process junta os argumentos com espaco SEM aspas: caminho com espaco quebraria.
  $argumentos = @($argumentos | ForEach-Object { if ("$_" -match '\s') { '"' + $_ + '"' } else { "$_" } })
  $p = Start-Process -FilePath $script:nodeExe -ArgumentList $argumentos -WorkingDirectory $cwd `
    -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $p.Handle   # PS 5.1: sem ler o Handle logo, o ExitCode volta vazio
  if (-not $p.WaitForExit($minutos * 60000)) {
    try { $p.Kill() } catch {}
    throw "$nome passou de $minutos min - interrompido (veja $err)."
  }
  return $p.ExitCode
}

# Cifra/decifra o dump do banco com DPAPI (so abre NESTA maquina) - igual ao backup diario.
# Antes o dump da atualizacao ficava em texto puro (ERR-050).
function Cifrar-Arquivo($de, $para) {
  Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
  $enc = [System.Security.Cryptography.ProtectedData]::Protect([System.IO.File]::ReadAllBytes($de), $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  [System.IO.File]::WriteAllBytes($para, $enc)
}
function Decifrar-Arquivo($de, $para) {
  Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
  $dec = [System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($de), $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  [System.IO.File]::WriteAllBytes($para, $dec)
}

# Saude DEPOIS de subir (ERR-048): o /ping responde na versao ESPERADA e os 4 servicos estao
# rodando - e continuam assim 30 s depois (um servico que cai em loop fica "Paused" no NSSM).
# Devolve $null se ok, ou o motivo.
function Checar-Saude($porta, $versao, $segundos = 120) {
  # Stop + stderr de nativo = erro fatal no PS 5.1 (licao do #457): aqui o codigo le o rc.
  $ErrorActionPreference = 'Continue'
  $saude = Join-Path $script:Raiz 'edge\saude-local.mjs'
  $fim = (Get-Date).AddSeconds($segundos)
  $ultimo = ''
  do {
    Start-Sleep -Seconds 3
    $ultimo = (& $script:nodeExe $saude $porta $versao 2>$null | Select-Object -Last 1)
    $rc = $LASTEXITCODE
  } while ($rc -ne 0 -and (Get-Date) -lt $fim)
  if ($rc -eq 1) { return "a API respondeu na versao '$ultimo', esperada '$versao'" }
  if ($rc -ne 0) { return "a API nao respondeu em $segundos s" }
  Start-Sleep -Seconds 30
  foreach ($s in $script:Servicos) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Running') { return "o servico $s esta '$($svc.Status)'" }
  }
  $null = (& $script:nodeExe $saude $porta $versao 2>$null)
  if ($LASTEXITCODE -ne 0) { return "a API parou de responder na versao $versao depois de subir" }
  return $null
}

# Telemetria pela rota PUBLICA (funciona mesmo sem token valido). Best-effort. Leva o fim do
# log - que nunca contem segredo (nenhum Diga imprime conexao/token).
function Enviar-Telemetria($cloud, $tipo, $msg, $extra) {
  try {
    $logTail = ""
    if (Test-Path $script:log) { $logTail = (Get-Content $script:log -Tail 40 -ErrorAction SilentlyContinue) -join "`n" }
    $corpo = @{ tipo = $tipo; erro = $msg; logTail = $logTail; modo = 'auto-update' }
    if ($extra) { foreach ($k in $extra.Keys) { $corpo[$k] = $extra[$k] } }
    Invoke-RestMethod -Method Post -Uri ("{0}/edge/telemetria/erro" -f $cloud) `
      -Body ($corpo | ConvertTo-Json -Compress) -ContentType "application/json" -TimeoutSec 15 | Out-Null
  } catch { Diga "(aviso) nao consegui enviar a telemetria: $($_.Exception.Message)" }
}

# BAIXA O PACOTE retomando de onde parou (ERR-279). Na loja o download ficava parado em 2%: a conexao
# parava de entregar bytes e a leitura esperava 10 min antes de desistir. Agora: $paradoSeg segundos sem
# nenhum byte -> reconecta e pede so o que falta (cabecalho Range), ate $tentativas vezes; servidor que
# responde o arquivo inteiro (200) -> recomeca do zero. HTTP 4xx (fora 408/429) e o teto param na hora.
# $aoProgresso recebe (lidos, total, estagio), estagio = 'baixando' ou 'retomando'. Devolve os bytes.
function Baixar-Pacote($url, $destino, $teto, $aoProgresso, $paradoSeg = 30, $tentativas = 20) {
  $lidos = [int64]0
  $total = [int64]-1
  $tent = 0
  while ($true) {
    $tent++
    $req = $null; $resp = $null; $rs = $null; $fs = $null
    try {
      $req = [System.Net.HttpWebRequest]::Create($url)
      $req.Timeout = 60000
      $req.ReadWriteTimeout = $paradoSeg * 1000
      if ($lidos -gt 0) { $req.AddRange([int64]$lidos) }
      $resp = $req.GetResponse()
      if ([int]$resp.StatusCode -eq 206) {
        $cr = [string]$resp.Headers['Content-Range']
        if ($cr -match '/(\d+)\s*$') { $total = [int64]$Matches[1] }
      } else {
        # O arquivo inteiro: primeira tentativa, ou o servidor nao aceitou o Range -> do zero.
        $lidos = [int64]0
        $total = [int64]$resp.ContentLength
      }
      if ($total -gt $teto) { throw "TETO: pacote maior que o teto ($total bytes)." }
      $rs = $resp.GetResponseStream()
      $modo = if ($lidos -gt 0) { [System.IO.FileMode]::Append } else { [System.IO.FileMode]::Create }
      $fs = New-Object System.IO.FileStream($destino, $modo, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
      $buf = New-Object byte[] 262144
      $tick = 0
      while (($n = $rs.Read($buf, 0, $buf.Length)) -gt 0) {
        $fs.Write($buf, 0, $n)
        $lidos += $n
        if ($lidos -gt $teto) { throw "TETO: o download passou do teto de tamanho - abortado." }
        $agora = [Environment]::TickCount
        if (($agora - $tick) -ge 250) {
          $tick = $agora
          if ($aoProgresso) { & $aoProgresso $lidos $total 'baixando' }
        }
      }
      if ($total -le 0 -or $lidos -ge $total) { return $lidos }
      throw "a conexao fechou antes do fim ($lidos de $total bytes)"
    } catch {
      $msg = $_.Exception.Message
      # Aborta a conexao parada: fechar a resposta pela metade esperaria o resto que nao vem.
      try { if ($req) { $req.Abort() } } catch {}
      if ($msg -like 'TETO:*') { throw ($msg -replace '^TETO:\s*', '') }
      # O status HTTP vem numa WebException (o PowerShell embrulha a excecao da chamada .NET).
      $ex = $_.Exception
      while ($ex -and -not ($ex -is [System.Net.WebException])) { $ex = $ex.InnerException }
      if ($ex -and $ex.Response) {
        $cod = [int]$ex.Response.StatusCode
        if ($cod -eq 416) { $lidos = [int64]0 }   # o pedaco pedido nao vale mais: recomeca do zero
        elseif ($cod -ge 400 -and $cod -lt 500 -and $cod -ne 408 -and $cod -ne 429) { throw "HTTP $cod ao baixar o pacote: $msg" }
      }
      if ($tent -ge $tentativas) { throw "o download nao terminou depois de $tentativas tentativas: $msg" }
      if ($aoProgresso) { & $aoProgresso $lidos $total 'retomando' }
      Diga ("(aviso) download parado em {0} MB ({1}) - retomando de onde parou, tentativa {2} de {3}..." -f `
        [math]::Round($lidos / 1MB, 1), $msg, ($tent + 1), $tentativas)
      Start-Sleep -Seconds ([math]::Min(10, 2 * $tent))
    } finally {
      if ($fs) { $fs.Close() }
      if ($rs) { $rs.Close() }
      if ($resp) { $resp.Close() }
    }
  }
}

# ICONE DO REGEM nos atalhos que a instalacao ja criou ("Regem (servidor local)", PDV, KDS, Ponto,
# Garcom, "Regem (nuvem)"). Ate a 1.30.5 o instalador punha o icone do navegador; atalho novo ja
# nasce com o do Regem (instalar-tudo.ps1) e a loja instalada recebe aqui, na atualizacao. So troca o
# icone - alvo e endereco ficam como estao - e so de atalho do navegador com nome "Regem...".
# O edge\regem.ico fica mesmo se a versao voltar (a volta sobrepoe os scripts, nao apaga os novos).
# Devolve quantos atalhos trocou.
function Icone-Regem-Nos-Atalhos($icone, $pastas) {
  if (-not (Test-Path -LiteralPath $icone)) { return 0 }
  $wsh = New-Object -ComObject WScript.Shell
  $n = 0
  foreach ($lnk in @(Get-ChildItem -Path $pastas -Filter 'Regem*.lnk' -File -ErrorAction SilentlyContinue)) {
    $sc = $wsh.CreateShortcut($lnk.FullName)
    if ($sc.TargetPath -match '(msedge|chrome)\.exe$' -and $sc.IconLocation -ne "$icone,0") {
      $sc.IconLocation = "$icone,0"
      $sc.Save()
      $n++
    }
  }
  return $n
}

# OS ICONES DO SERVIDOR NA ATUALIZACAO (.zip) - plano do dono de 25/10/2026 (menos reinstalacao por .exe). Antes o .zip
# copiava so os arquivos soltos de edge\, e o edge\bandeja (RegemServidor.exe, RegemEstacao.exe) so mudava reinstalando:
# a correcao do icone do servidor (TLS 1.2, ERR-303) teria de esperar um .exe. O icone ABERTO nao pode ser apagado nem
# sobrescrito, mas pode ser RENOMEADO: o atual vira "<nome>.antigo-<data>", o novo entra no lugar e o icone do servidor
# percebe a troca e se reabre sozinho (RegemServidor.cs). A copia antiga sai quando ninguem a usa mais (cada chamada
# tenta apagar). Igual (mesmo SHA-256) nao troca. Copia que falha devolve o antigo ao lugar. Devolve quantos trocou.
# .NET direto (e nao Rename-Item/Copy-Item): o provider do PowerShell recusa caminho curto com ~ (ERR-243).
function Trocar-Icones($de, $para) {
  if (-not [IO.Directory]::Exists($de)) { return 0 }
  [void][IO.Directory]::CreateDirectory($para)
  $hash = {
    param($arq)
    $s = [IO.File]::OpenRead($arq)
    try { return [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($s)) } finally { $s.Dispose() }
  }
  $n = 0
  foreach ($novo in [IO.Directory]::GetFiles($de, '*.exe')) {
    $alvo = [IO.Path]::Combine($para, [IO.Path]::GetFileName($novo))
    $guardado = $null
    if ([IO.File]::Exists($alvo)) {
      if ((& $hash $alvo) -eq (& $hash $novo)) { continue }
      $guardado = '{0}.antigo-{1}-{2}' -f $alvo, (Get-Date -Format 'yyyyMMddHHmmss'), (Get-Random -Maximum 100000)
      [IO.File]::Move($alvo, $guardado)
    }
    try {
      [IO.File]::Copy($novo, $alvo, $true)
    } catch {
      if ($guardado) { try { [IO.File]::Move($guardado, $alvo) } catch { } }
      throw
    }
    $n++
  }
  foreach ($velho in [IO.Directory]::GetFiles($para, '*.antigo-*')) {
    try { [IO.File]::Delete($velho) } catch { }
  }
  return $n
}
