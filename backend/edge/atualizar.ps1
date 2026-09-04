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
$script:baixadoMb = $null   # bytes baixados (MB) - barra de download real
$script:totalMb   = $null   # tamanho total (MB), quando o servidor informa
$script:acaoFinal = $null   # o que o usuario precisa fazer ao terminar (ou nada)
# fase: 'baixando' | 'instalando' | 'ok' | 'erro' - a UI mostra uma barra por fase.
# pct: 0..100 DENTRO da fase (download real na fase 'baixando'; passos na 'instalando').
function Prog($estagio, $pct, $fase = 'instalando', $erro = $null) {
  try {
    $o = @{
      fase = $fase; estagio = $estagio; pct = $pct; versao = $script:versaoNova
      baixadoMb = $script:baixadoMb; totalMb = $script:totalMb
      acaoFinal = $script:acaoFinal; erro = $erro; ts = (Get-Date -Format o)
    }
    $o | ConvertTo-Json -Compress | Set-Content -Path $statusFile -Encoding UTF8
  } catch {}
}
Prog "iniciando" 0 'baixando'

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

# ---- decifra segredos DPAPI (prefixo enc:) ----
# O atualizar.ps1 roda como SYSTEM (mesma conta LocalMachine que cifrou via
# proteger-env.ps1). Este era o UNICO script do edge que lia o .env.local CRU:
# sem decifrar, o pg_dump recebia EDGE_DATABASE_URL="enc:..." (travava/falhava) e a
# telemetria mandava x-sync-token cifrado (rejeitado pela nuvem -> nenhuma falha
# aparecia no console). Agora decifra EDGE_DATABASE_URL e SYNC_TOKEN igual aos daemons.
function DecDpapi($v) {
  if (-not $v) { return $v }
  if (-not $v.StartsWith('enc:')) { return $v }
  try {
    Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
    $bytes = [Convert]::FromBase64String($v.Substring(4))
    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
      $bytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    return [System.Text.Encoding]::UTF8.GetString($dec)
  } catch { Diga "(aviso) nao decifrei um segredo DPAPI: $($_.Exception.Message)"; return $v }
}
foreach ($k in @('EDGE_DATABASE_URL', 'DATABASE_URL', 'SYNC_TOKEN', 'JWT_SECRET')) {
  if ($cfg.ContainsKey($k)) { $cfg[$k] = DecDpapi $cfg[$k] }
}

# Telemetria de falha pela rota PUBLICA (/edge/telemetria/erro, sem token) - funciona
# mesmo se o SYNC_TOKEN nao decifrar. Best-effort. Reusada na fase inicial e no rollback.
function PostErro($tipo, $msg) {
  try {
    $logTail = ""
    if (Test-Path $script:logArquivo) { $logTail = (Get-Content $script:logArquivo -Tail 40 -ErrorAction SilentlyContinue) -join "`n" }
    $corpo = @{
      tipo = $tipo; erro = $msg; logTail = $logTail
      versaoNova = $script:versaoNova; versaoAtual = $versaoAtual
      tenantId = $cfg.EDGE_TENANT_ID; modo = 'auto-update'
    } | ConvertTo-Json -Compress
    Invoke-RestMethod -Method Post -Uri ("{0}/edge/telemetria/erro" -f $cloud) `
      -Body $corpo -ContentType "application/json" -TimeoutSec 15 | Out-Null
    Diga "Telemetria de falha enviada (rota publica)."
  } catch { Diga "(aviso) nao consegui enviar a telemetria: $($_.Exception.Message)" }
}

# ---- FASE INICIAL protegida (update-check, assinatura, download, SHA, backup) ----
# Antes, qualquer throw AQUI ficava FORA do try/catch (que so cobria a troca de
# servicos): a UI travava girando (sem 'erro') e a distribuicao nunca via a falha.
# Agora todo aborto da fase inicial grava Prog 'erro' + posta telemetria.
try {
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
# LE-1 (auditoria ago/2026): assinatura OBRIGATORIA por padrao (fail-closed). Como o
# pacote SEMPRE traz edge\update-pub.pem, so desligamos com EDGE_REQUIRE_SIGNED_UPDATE
# ='false' explicito (ex.: bancada de teste). Antes o default era 'so exige se =true',
# o que deixava a nuvem/canal empurrar zip sem assinatura = RCE em massa como SYSTEM.
$reqSig = ($cfg.EDGE_REQUIRE_SIGNED_UPDATE -ne 'false')
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
Prog "baixando" 0 'baixando'

# ---- 2) baixa em STREAM (barra REAL por bytes) e confere o SHA-256 ANTES de tocar em nada ----
$tmp = Join-Path $env:TEMP ("regem-edge-{0}" -f (Get-Random))
New-Item -ItemType Directory -Force $tmp | Out-Null
$zip = Join-Path $tmp "pacote.zip"

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$reqDl = [System.Net.HttpWebRequest]::Create($info.url)
$reqDl.Timeout = 600000; $reqDl.ReadWriteTimeout = 600000
$respDl = $reqDl.GetResponse()
$totalBytes = [int64]$respDl.ContentLength   # -1 se o servidor nao informar
$script:totalMb = if ($totalBytes -gt 0) { [math]::Round($totalBytes / 1MB, 1) } else { $null }
$rs = $respDl.GetResponseStream()
$fs = [System.IO.File]::Create($zip)
try {
  $buf = New-Object byte[] 262144   # 256 KB por leitura
  $lidos = [int64]0; $ultimoTick = 0
  while (($n = $rs.Read($buf, 0, $buf.Length)) -gt 0) {
    $fs.Write($buf, 0, $n)
    $lidos += $n
    $agora = [Environment]::TickCount
    if (($agora - $ultimoTick) -ge 250) {   # atualiza ~4x/s (nao martela o status.json)
      $ultimoTick = $agora
      $script:baixadoMb = [math]::Round($lidos / 1MB, 1)
      $pctDl = if ($totalBytes -gt 0) { [int](($lidos * 100) / $totalBytes) } else { 50 }
      Prog "baixando" $pctDl 'baixando'
    }
  }
} finally { $fs.Close(); $rs.Close(); $respDl.Close() }
$script:baixadoMb = [math]::Round($lidos / 1MB, 1)
Prog "baixando" 100 'baixando'

$sha = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
if ($sha -ne ($info.sha256.ToLower())) {
  throw "SHA-256 NAO confere (esperado $($info.sha256), obtido $sha). Abortando - pacote corrompido ou adulterado."
}
Diga "SHA-256 confere. Extraindo..."
Prog "conferindo" 5
$novo = Join-Path $tmp "novo"
Expand-Archive -Path $zip -DestinationPath $novo -Force

# ---- 3) BACKUP (banco + codigo) ----
Prog "backup" 20
$bakDir = Join-Path $Raiz ("backup-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
New-Item -ItemType Directory -Force $bakDir | Out-Null
$dumpFile = Join-Path $bakDir "db.dump"
$pgdump = (Get-Command pg_dump -ErrorAction SilentlyContinue)
if ($pgdump -and $cfg.EDGE_DATABASE_URL) {
  # Backup com TIMEOUT (120s) e NÃO-FATAL: se o pg_dump travar (Postgres ocupado) ou
  # falhar, NÃO aborta o update — o backup é defensivo e o rollback de CÓDIGO (dist.bak)
  # segue valendo. Antes, um pg_dump pendurado travava o update inteiro (fase "backup").
  Diga "Backup do banco (timeout 120s) -> $dumpFile"
  $job = Start-Job -ScriptBlock {
    param($exe, $file, $conn) & $exe --format=custom --file $file $conn
  } -ArgumentList $pgdump.Source, $dumpFile, $cfg.EDGE_DATABASE_URL
  if (Wait-Job $job -Timeout 120) {
    Receive-Job $job 2>&1 | Out-Null
    if ($job.State -eq 'Completed') { Diga "Backup do banco OK." }
    else { Diga "AVISO: pg_dump falhou - seguindo SEM backup de banco (rollback de codigo via dist.bak segue valendo)." }
  } else {
    Diga "AVISO: pg_dump excedeu 120s (Postgres ocupado?) - CANCELANDO o backup e seguindo (rollback de codigo via dist.bak segue valendo)."
    Stop-Job $job -ErrorAction SilentlyContinue
    Get-Process pg_dump -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  }
  Remove-Job $job -Force -ErrorAction SilentlyContinue
} else {
  Diga "AVISO: pg_dump nao encontrado (ou EDGE_DATABASE_URL vazio). Seguindo SEM backup de banco."
}
$distAtual = Join-Path $Raiz "dist"
$distBak   = Join-Path $bakDir "dist"
if (Test-Path $distAtual) { Copy-Item $distAtual $distBak -Recurse -Force; Diga "Backup do codigo -> $distBak" }
# Backup do frontend (app) — via TAR (Copy-Item sofre MAX_PATH no node_modules do next)
# e NÃO-FATAL (o rollback de código = dist.bak é o que importa; o web se reextrai do
# web.tar do pacote). Gera backup-*/web.tar; o reverter.ps1 restaura dele se existir.
$webAtual = Join-Path $Raiz "web"
if (Test-Path $webAtual) {
  try {
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
    & $tarExe -cf (Join-Path $bakDir 'web.tar') -C $webAtual .
    if ($LASTEXITCODE -eq 0) { Diga "Backup do app -> $bakDir\web.tar" }
    else { Diga "(aviso) backup do app (tar rc=$LASTEXITCODE) - seguindo (rollback de codigo via dist.bak segue valendo)." }
  } catch { Diga "(aviso) nao consegui fazer backup do app: $($_.Exception.Message) - seguindo." }
}

}
catch {
  # Falha na FASE INICIAL (antes de tocar nos servicos/arquivos): nada foi trocado,
  # nao ha rollback a fazer. So reporta para a UI destravar e para a distribuicao ver.
  $errIni = $_.Exception.Message
  Diga "ERRO (fase inicial): $errIni"
  $script:acaoFinal = "A atualizacao nao chegou a ser aplicada (falhou na preparacao). Nenhuma alteracao foi feita. Tente novamente; se persistir, reinicie o computador."
  Prog "erro" 100 'erro' $errIni
  PostErro "update_falha" $errIni
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
  throw
}

# ---- 4) para servicos, troca arquivos, migra, sobe ----
# nssm escreve avisos no stderr (ex.: parar um servico que tem DEPENDENTES rodando).
# No PS 5.1, redirecionar o stderr de um nativo (2>) faz o PS embrulhar cada linha como
# NativeCommandError; com ErrorActionPreference=Stop isso ABORTAVA o update inteiro no
# "Parando servicos" (RegemEdgeApi tem dependentes) — sem log de erro na UI. Blinda com
# EA=Continue local + try (o stop/start e best-effort; o health-check depois valida).
function Svc($acao, $nome) {
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $nssmExe $acao $nome 2>&1 | Out-Null } catch { }
  $ErrorActionPreference = $ea
}
# Para os DEPENDENTES primeiro e o Api por ULTIMO (Web/Sync/Impressao dependem do Api;
# parar o Api com dependentes vivos faz o SCM recusar e o nssm cuspir o aviso).
Diga "Parando servicos..."; Prog "trocando" 45; Svc stop "RegemEdgeWeb"; Svc stop "RegemEdgeImpressao"; Svc stop "RegemEdgeSync"; Svc stop "RegemEdgeApi"

try {
  Diga "Trocando arquivos (dist, migrations, scripts, package)..."
  # NOTA: "web" NAO entra aqui — vem como web.tar e e extraido abaixo (MAX_PATH).
  foreach ($item in @("dist", "database", "scripts", "package.json", "package-lock.json")) {
    $de  = Join-Path $novo $item
    $para = Join-Path $Raiz $item
    if (Test-Path $de) {
      if (Test-Path $para) { Remove-Item $para -Recurse -Force }
      Copy-Item $de $para -Recurse -Force
    }
  }

  # App (web/) via TAR: extrai com `tar` (respeita caminhos > 260). Sem isto, o
  # Expand-Archive/copia do .zip DROPA os arquivos profundos do next (MAX_PATH) e o
  # RegemEdgeWeb cai em loop ("Cannot find module 'next'"). So troca o web se o pacote
  # trouxe web.tar; senao mantem o atual (nao quebra um edge que ja tinha web bom).
  $webTarNovo = Join-Path $novo 'web.tar'
  if (Test-Path $webTarNovo) {
    Diga "Extraindo o app (web.tar -> web\)..."
    $webPara = Join-Path $Raiz 'web'
    if (Test-Path $webPara) { Remove-Item $webPara -Recurse -Force -ErrorAction SilentlyContinue }
    New-Item -ItemType Directory -Force $webPara | Out-Null
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
    & $tarExe -xf $webTarNovo -C $webPara
    if ($LASTEXITCODE -ne 0) { throw "Falha ao extrair web.tar (tar rc=$LASTEXITCODE)." }
    if (-not (Test-Path (Join-Path $webPara 'node_modules\next'))) { throw "web extraido sem node_modules\next." }
    Diga "App atualizado (web\ extraido, next presente)."
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

  Diga "Aplicando migrations locais..."; Prog "migrando" 70
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

  # AUTO-CURA da tarefa de UPDATE: re-registra RegemEdgeUpdate com -ExecutionTimeLimit
  # 15min (mata sozinha se travar). Edges instalados antes desta versao tinham a tarefa
  # SEM o limite: uma execucao travada (pg_dump) ficava "Running" e o clique novo era
  # ignorado ("nada acontece"). A partir de agora, todo .zip conserta a propria tarefa.
  # O "matar a execucao presa antes de re-disparar" e feito pelo edge.service (/end).
  try {
    $atualizar = Join-Path $Raiz "edge\atualizar.ps1"
    if (Test-Path $atualizar) {
      $acaoU = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument ("-ExecutionPolicy Bypass -NoProfile -File `"{0}`" -Raiz `"{1}`"" -f $atualizar, $Raiz)
      $contaU = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
      # NÃO usar -MultipleInstances StopExisting (enum ausente em alguns Windows → faz
      # o Register falhar). O /end antes do /run (edge.service) já mata a execução presa.
      $cfgU = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
      Register-ScheduledTask -TaskName "RegemEdgeUpdate" -Action $acaoU -Principal $contaU -Settings $cfgU -Force | Out-Null
      Diga "Tarefa RegemEdgeUpdate re-registrada (limite 15min)."
    }
  } catch { Diga "(aviso) nao re-registrei RegemEdgeUpdate: $($_.Exception.Message)" }

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

  Diga "Subindo servicos..."; Prog "subindo" 88; Svc start "RegemEdgeApi"; Svc start "RegemEdgeSync"; Svc start "RegemEdgeImpressao"; Svc start "RegemEdgeWeb"

  Prog "verificando" 96
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

  # Servicos reiniciaram e o /ping respondeu - nenhuma acao manual necessaria.
  $script:acaoFinal = "Pronto! Nenhuma acao necessaria - os servicos ja reiniciaram. Recarregue a pagina se ela nao atualizar sozinha."
  Prog "ok" 100 'ok'
  Diga "OK! Atualizado para $($info.ultima). Backup em: $bakDir"
}
catch {
  $errMsg = $_.Exception.Message
  Diga "ERRO: $errMsg"
  $script:acaoFinal = "A atualizacao foi revertida automaticamente (o servidor voltou a versao anterior). Recarregue a pagina; se o problema persistir, use 'Reverter atualizacao' ou reinicie o computador."
  Prog "erro" 100 'erro' $errMsg
  # Telemetria de falha pela rota PUBLICA (funciona mesmo sem token valido).
  PostErro "update_falha" $errMsg
  Diga "ROLLBACK do codigo (dist.bak)..."
  Svc stop "RegemEdgeWeb"; Svc stop "RegemEdgeImpressao"; Svc stop "RegemEdgeSync"; Svc stop "RegemEdgeApi"
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
