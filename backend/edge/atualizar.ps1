# Regem Edge - APLICAR atualizacao no PC da LOJA (blue-green + backup + rollback).
#
# Fluxo seguro:
#   1) pergunta a versao nova a nuvem (/edge/update-check) e compara com a atual
#   2) baixa o .zip e CONFERE o SHA-256 (integridade) antes de tocar em nada
#   3) BACKUP: pg_dump do banco local + copia da pasta dist atual (dist.bak)
#   4) para os servicos, troca os arquivos, roda migrations, sobe os servicos
#   5) HEALTH-CHECK no /ping; se falhar, ROLLBACK do codigo (dist.bak) e reinicia
#
# Rode como Administrador (PowerShell), na pasta do edge:
#   .\edge\atualizar.ps1 -Raiz "C:\regem-edge\backend"
#   .\edge\atualizar.ps1 -Raiz "C:\regem-edge\backend" -Forcar   # ignora o "ja esta na ultima"
#
# Recomendado rodar com a loja FECHADA. Nada e aplicado se o SHA nao bater.
param(
  [string]$Raiz = "C:\regem-edge\backend",
  [switch]$Forcar
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $Raiz "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("atualizar-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
function Diga($m) { $l = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $l; Add-Content $log $l }

# Progresso da atualizacao para a UI (/servidor le este arquivo pela API). Estagios
# com % aproximado; a UI mostra a barra e, no reinicio dos servicos, reconecta.
$statusFile = Join-Path $logDir "update-status.json"
$script:versaoNova = ""
$script:logArquivo = $log
function Prog($estagio, $pct, $erro = $null) {
  try {
    $o = @{ estagio = $estagio; pct = $pct; versao = $script:versaoNova; erro = $erro; ts = (Get-Date -Format o) }
    $o | ConvertTo-Json -Compress | Set-Content -Path $statusFile -Encoding UTF8
  } catch {}
}
Prog "iniciando" 2

# Resolve Node/Postgres/NSSM EMBUTIDOS - o auto-update roda como SYSTEM (agendado),
# sem o PATH do usuario. Prende os do bundle na frente do PATH desta sessao.
$edgeBase = Split-Path $Raiz -Parent
if (Test-Path (Join-Path $edgeBase 'node\node.exe')) { $env:Path = (Join-Path $edgeBase 'node') + ';' + $env:Path }
if (Test-Path (Join-Path $edgeBase 'pgsql\bin'))     { $env:Path = (Join-Path $edgeBase 'pgsql\bin') + ';' + $env:Path }
$nssmExe = if (Test-Path (Join-Path $edgeBase 'nssm\nssm.exe')) { Join-Path $edgeBase 'nssm\nssm.exe' } else { 'nssm' }

# ---- le o .env.local (APP_VERSION, CLOUD_API, EDGE_DATABASE_URL) ----
$envFile = Join-Path $Raiz ".env.local"
if (-not (Test-Path $envFile)) { throw ".env.local nao encontrado em $Raiz" }
$cfg = @{}
foreach ($linha in Get-Content $envFile) {
  if ($linha -match '^\s*#') { continue }
  if ($linha -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
}
$versaoAtual = if ($cfg.APP_VERSION) { $cfg.APP_VERSION } else { "0" }
$cloud = $cfg.CLOUD_API.TrimEnd("/")
if (-not $cloud) { throw "CLOUD_API ausente no .env.local" }

Diga "Versao instalada: $versaoAtual - consultando a nuvem..."
$info = Invoke-RestMethod -Uri ("{0}/edge/update-check?versao={1}" -f $cloud, $versaoAtual) -TimeoutSec 30
if (-not $info.atualizar -and -not $Forcar) { Diga "Ja esta na ultima versao ($($info.ultima)). Nada a fazer."; return }
if (-not $info.url)    { throw "A nuvem nao informou EDGE_UPDATE_URL - nao ha pacote para baixar." }
if (-not $info.sha256) { throw "A nuvem nao informou EDGE_UPDATE_SHA256 - recusando por seguranca." }
$script:versaoNova = $info.ultima

# ---- Fase 3: anti-downgrade (recusa versao MENOR, mesmo com -Forcar) ----
function VerNum($v) { ,@(($v -split '\.') | ForEach-Object { [int]($_ -replace '\D', '') }) }
$vn = VerNum $info.ultima; $va = VerNum $versaoAtual
for ($i = 0; $i -lt [Math]::Max($vn.Count, $va.Count); $i++) {
  $x = if ($i -lt $vn.Count) { $vn[$i] } else { 0 }
  $y = if ($i -lt $va.Count) { $va[$i] } else { 0 }
  if ($x -lt $y) { throw "Downgrade BLOQUEADO: nova ($($info.ultima)) < instalada ($versaoAtual)." }
  if ($x -gt $y) { break }
}

# ---- Fase 3: verificacao da ASSINATURA (Ed25519) via helper node ----
$edgeBaseV = Split-Path $Raiz -Parent
$nodeV = if (Test-Path (Join-Path $edgeBaseV 'node\node.exe')) { Join-Path $edgeBaseV 'node\node.exe' } else { 'node' }
$reqSig = ($cfg.EDGE_REQUIRE_SIGNED_UPDATE -eq 'true')
if ($info.assinatura) {
  & $nodeV (Join-Path $Raiz 'edge\verify-update.mjs') $info.ultima $info.sha256 $info.url $info.assinatura
  $rc = $LASTEXITCODE
  if ($rc -eq 1) { throw "Assinatura do release INVALIDA - recusando (possivel adulteracao do canal de release)." }
  elseif ($rc -eq 0) { Diga "Assinatura do release confere (Ed25519)." }
  elseif ($reqSig) { throw "Nao consegui verificar a assinatura (sem chave publica) e EDGE_REQUIRE_SIGNED_UPDATE=true." }
  else { Diga "(aviso) assinatura nao verificada (sem chave publica) - tolerando." }
}
elseif ($reqSig) { throw "Release SEM assinatura e EDGE_REQUIRE_SIGNED_UPDATE=true - recusando." }
else { Diga "(aviso) release sem assinatura - tolerando (defina EDGE_REQUIRE_SIGNED_UPDATE=true p/ exigir)." }

Diga "Nova versao: $($info.ultima). Baixando $($info.url)"
Prog "baixando" 15

# ---- 2) baixa e confere o SHA-256 ANTES de tocar em nada ----
$tmp = Join-Path $env:TEMP ("regem-edge-{0}" -f (Get-Random))
New-Item -ItemType Directory -Force $tmp | Out-Null
$zip = Join-Path $tmp "pacote.zip"
Invoke-WebRequest -Uri $info.url -OutFile $zip -TimeoutSec 600
$sha = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
if ($sha -ne ($info.sha256.ToLower())) {
  throw "SHA-256 NAO confere (esperado $($info.sha256), obtido $sha). Abortando - pacote corrompido ou adulterado."
}
Diga "SHA-256 confere. Extraindo..."
Prog "conferindo" 35
$novo = Join-Path $tmp "novo"
Expand-Archive -Path $zip -DestinationPath $novo -Force

# ---- 3) BACKUP (banco + codigo) ----
Prog "backup" 50
$bakDir = Join-Path $Raiz ("backup-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $bakDir | Out-Null
$dumpFile = Join-Path $bakDir "db.dump"
$pgdump = (Get-Command pg_dump -ErrorAction SilentlyContinue)
if ($pgdump -and $cfg.EDGE_DATABASE_URL) {
  Diga "Backup do banco -> $dumpFile"
  & $pgdump.Source --format=custom --file $dumpFile $cfg.EDGE_DATABASE_URL
  if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou - abortando antes de mexer no banco." }
} else {
  Diga "AVISO: pg_dump nao encontrado (ou EDGE_DATABASE_URL vazio). Seguindo SEM backup de banco."
}
$distAtual = Join-Path $Raiz "dist"
$distBak   = Join-Path $bakDir "dist"
if (Test-Path $distAtual) { Copy-Item $distAtual $distBak -Recurse -Force; Diga "Backup do codigo -> $distBak" }
# Backup do frontend tambem, para o rollback manual (reverter.ps1) restaurar os dois.
$webAtual = Join-Path $Raiz "web"
$webBak   = Join-Path $bakDir "web"
if (Test-Path $webAtual) { Copy-Item $webAtual $webBak -Recurse -Force; Diga "Backup do app -> $webBak" }

# ---- 4) para servicos, troca arquivos, migra, sobe ----
function Svc($acao, $nome) { & $nssmExe $acao $nome 2>$null | Out-Null }
Diga "Parando servicos..."; Prog "trocando" 65; Svc stop "RegemEdgeApi"; Svc stop "RegemEdgeSync"; Svc stop "RegemEdgeImpressao"; Svc stop "RegemEdgeWeb"

try {
  Diga "Trocando arquivos (dist, migrations, scripts, package)..."
  foreach ($item in @("dist", "web", "database", "scripts", "package.json", "package-lock.json")) {
    $de  = Join-Path $novo $item
    $para = Join-Path $Raiz $item
    if (Test-Path $de) {
      if (Test-Path $para) { Remove-Item $para -Recurse -Force }
      Copy-Item $de $para -Recurse -Force
    }
  }

  # Atualiza os arquivos do EDGE (daemons .mjs + scripts .ps1) com COPIA OVERLAY -
  # arquivo por arquivo, SEM apagar a pasta (o proprio atualizar.ps1 roda de dentro
  # dela). Assim daemons novos (ex.: impressao-daemon) chegam pelo auto-update, e
  # nao so na reinstalacao completa. Um arquivo travado nao aborta o update.
  $edgeDe = Join-Path $novo "edge"
  if (Test-Path $edgeDe) {
    Diga "Atualizando scripts do edge (overlay)..."
    New-Item -ItemType Directory -Force (Join-Path $Raiz "edge") | Out-Null
    Get-ChildItem -Path $edgeDe -File | ForEach-Object {
      try { Copy-Item $_.FullName (Join-Path $Raiz ("edge\" + $_.Name)) -Force }
      catch { Diga "  (aviso) nao troquei edge\$($_.Name): $($_.Exception.Message)" }
    }
  }

  Diga "npm ci (caso deps tenham mudado)..."
  Push-Location $Raiz; npm ci --omit=dev; $ciCode = $LASTEXITCODE; Pop-Location
  if ($ciCode -ne 0) { throw "npm ci falhou." }

  Diga "Aplicando migrations locais..."; Prog "migrando" 80
  Push-Location $Raiz; node scripts\apply-all-local.mjs; $mgCode = $LASTEXITCODE; Pop-Location
  if ($mgCode -ne 0) { throw "migrations falharam." }

  # Garante servicos que podem NAO existir num edge instalado antes desta versao
  # (ex.: RegemEdgeImpressao). Idempotente: so registra o que faltar.
  $nodeExe = if (Test-Path (Join-Path $edgeBase 'node\node.exe')) { Join-Path $edgeBase 'node\node.exe' } else { 'node' }
  function GarantirSvc($nome, $script) {
    $status = (& $nssmExe status $nome 2>$null)
    if (-not $status) {
      Diga "Registrando servico faltante: $nome"
      & $nssmExe install $nome $nodeExe | Out-Null
      & $nssmExe set $nome AppParameters $script | Out-Null
      & $nssmExe set $nome AppDirectory $Raiz | Out-Null
      & $nssmExe set $nome Start SERVICE_AUTO_START | Out-Null
      & $nssmExe set $nome AppStdout (Join-Path $Raiz ("logs\" + $nome + ".log")) | Out-Null
      & $nssmExe set $nome AppStderr (Join-Path $Raiz ("logs\" + $nome + ".err.log")) | Out-Null
    }
  }
  GarantirSvc "RegemEdgeImpressao" (Join-Path $Raiz "edge\impressao-daemon.mjs")

  # Garante a tarefa de ROLLBACK (edge instalado antes desta versao nao a tinha).
  # Idempotente (-Force). Sem ela o botao "Reverter atualizacao" do app nao funciona.
  try {
    $reverter = Join-Path $Raiz "edge\reverter.ps1"
    if (Test-Path $reverter) {
      $acaoR = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument ("-ExecutionPolicy Bypass -NoProfile -File `"{0}`" -Raiz `"{1}`"" -f $reverter, $Raiz)
      $contaR = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
      $cfgR = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
      Register-ScheduledTask -TaskName "RegemEdgeRollback" -Action $acaoR -Principal $contaR -Settings $cfgR -Force | Out-Null
      Diga "Tarefa RegemEdgeRollback garantida."
    }
  } catch { Diga "(aviso) nao registrei RegemEdgeRollback: $($_.Exception.Message)" }

  # Atualiza APP_VERSION no .env.local ANTES de subir (senao o daemon/update-check
  # ainda se acham na versao antiga e rebaixam o mesmo pacote em loop).
  try {
    $linhas = Get-Content $envFile
    if ($linhas -match '^\s*APP_VERSION\s*=') {
      $linhas = $linhas | ForEach-Object { if ($_ -match '^\s*APP_VERSION\s*=') { "APP_VERSION=$($info.ultima)" } else { $_ } }
    } else {
      $linhas += "APP_VERSION=$($info.ultima)"
    }
    Set-Content -Path $envFile -Value $linhas -Encoding UTF8
    Diga "APP_VERSION atualizado para $($info.ultima) no .env.local."
  } catch { Diga "(aviso) nao consegui atualizar APP_VERSION: $($_.Exception.Message)" }

  Diga "Subindo servicos..."; Prog "subindo" 90; Svc start "RegemEdgeApi"; Svc start "RegemEdgeSync"; Svc start "RegemEdgeImpressao"; Svc start "RegemEdgeWeb"

  Prog "verificando" 95
  # ---- 5) HEALTH-CHECK (ate ~40s) ----
  # PS 5.1 nao tem -SkipCertificateCheck; aceita o cert local via callback + TLS 1.2.
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  try { [System.Net.ServicePointManager]::ServerCertificateValidationCallback = { $true } } catch {}
  $porta = if ($cfg.PORT) { $cfg.PORT } else { "3001" }
  $ok = $false
  foreach ($i in 1..20) {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest -Uri ("https://localhost:{0}/api/v1/ping" -f $porta) -TimeoutSec 5 -UseBasicParsing
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch {
      # PS 5.1 pode falhar o TLS com o cert local; confirma pela porta TCP aberta.
      try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('localhost', [int]$porta); if ($c.Connected) { $ok = $true }; $c.Close() } catch {}
      if ($ok) { break }
    }
  }
  if (-not $ok) { throw "Health-check /ping falhou apos a troca." }

  Prog "ok" 100
  Diga "OK! Atualizado para $($info.ultima). Backup em: $bakDir"
}
catch {
  $errMsg = $_.Exception.Message
  Diga "ERRO: $errMsg"
  Prog "erro" 100 $errMsg
  # Telemetria de falha p/ a distribuicao (best-effort): versao, erro e o FIM do log.
  try {
    $logTail = ""
    if (Test-Path $script:logArquivo) { $logTail = (Get-Content $script:logArquivo -Tail 40 -ErrorAction SilentlyContinue) -join "`n" }
    $corpo = @{
      origem  = "update"
      tipo    = "update_falha"
      nivel   = "fatal"
      unidadeId = $cfg.EDGE_UNIDADE_ID
      versao  = $script:versaoNova
      mensagem = $errMsg
      logTail = $logTail
    } | ConvertTo-Json -Compress
    $hdr = @{ "x-sync-token" = $cfg.SYNC_TOKEN }
    Invoke-RestMethod -Method Post -Uri ("{0}/edge/telemetria" -f $cloud) -Headers $hdr -Body $corpo -ContentType "application/json" -TimeoutSec 15 | Out-Null
    Diga "Telemetria de falha enviada a distribuicao."
  } catch { Diga "(aviso) nao consegui enviar a telemetria: $($_.Exception.Message)" }
  Diga "ROLLBACK do codigo (dist.bak)..."
  Svc stop "RegemEdgeApi"; Svc stop "RegemEdgeSync"; Svc stop "RegemEdgeImpressao"; Svc stop "RegemEdgeWeb"
  if (Test-Path $distBak) {
    if (Test-Path $distAtual) { Remove-Item $distAtual -Recurse -Force }
    Copy-Item $distBak $distAtual -Recurse -Force
  }
  # Reverte APP_VERSION (o codigo voltou a ser o antigo).
  try {
    $linhas = Get-Content $envFile | ForEach-Object { if ($_ -match '^\s*APP_VERSION\s*=') { "APP_VERSION=$versaoAtual" } else { $_ } }
    Set-Content -Path $envFile -Value $linhas -Encoding UTF8
  } catch {}
  Svc start "RegemEdgeApi"; Svc start "RegemEdgeSync"; Svc start "RegemEdgeImpressao"; Svc start "RegemEdgeWeb"
  Diga "Codigo restaurado. Se a migration ja rodou e o problema for o banco, restaure manualmente:"
  Diga "   pg_restore --clean --dbname `"$($cfg.EDGE_DATABASE_URL)`" `"$dumpFile`""
  throw
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
