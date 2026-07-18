# Regem Edge - REVERTER (rollback manual) para a versao anterior a ultima atualizacao.
#
# Restaura o codigo (dist) e o app (web) do backup mais recente criado pelo
# atualizar.ps1 (pasta backup-*). NAO restaura o banco por padrao (evita perder o
# que foi operado apos a atualizacao); use -ComBanco so se o problema for de dados.
#
# Disparado pelo botao "Reverter atualizacao" do app (schtasks /run /tn RegemEdgeRollback),
# que roda esta tarefa como SYSTEM. Recomendado com a loja FECHADA.
param(
  [string]$Raiz = "C:\regem-edge\backend",
  [switch]$ComBanco
)

$ErrorActionPreference = "Stop"
$logDir = Join-Path $Raiz "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("reverter-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
function Diga($m) { $l = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m; Write-Host $l; Add-Content $log $l }

# Resolve Node/Postgres/NSSM EMBUTIDOS (roda como SYSTEM, sem o PATH do usuario).
$edgeBase = Split-Path $Raiz -Parent
if (Test-Path (Join-Path $edgeBase 'node\node.exe')) { $env:Path = (Join-Path $edgeBase 'node') + ';' + $env:Path }
if (Test-Path (Join-Path $edgeBase 'pgsql\bin'))     { $env:Path = (Join-Path $edgeBase 'pgsql\bin') + ';' + $env:Path }
$nssmExe = if (Test-Path (Join-Path $edgeBase 'nssm\nssm.exe')) { Join-Path $edgeBase 'nssm\nssm.exe' } else { 'nssm' }

# ---- .env.local (PORT, EDGE_DATABASE_URL) ----
$envFile = Join-Path $Raiz ".env.local"
if (-not (Test-Path $envFile)) { throw ".env.local nao encontrado em $Raiz" }
$cfg = @{}
foreach ($linha in Get-Content $envFile) {
  if ($linha -match '^\s*#') { continue }
  if ($linha -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
}

# ---- acha o backup MAIS RECENTE (backup-yyyyMMdd-HHmmss) ----
$bak = Get-ChildItem -Path $Raiz -Directory -Filter 'backup-*' -ErrorAction SilentlyContinue |
  Sort-Object Name -Descending | Select-Object -First 1
if (-not $bak) { throw "Nenhum backup encontrado em $Raiz. Nada para reverter." }
Diga "Revertendo a partir de: $($bak.FullName)"
$distBak = Join-Path $bak.FullName "dist"
$webBak  = Join-Path $bak.FullName "web"
$dumpFile = Join-Path $bak.FullName "db.dump"
if (-not (Test-Path $distBak)) { throw "Backup sem pasta 'dist' - nao da para reverter o codigo." }

function Svc($acao, $nome) { & $nssmExe $acao $nome 2>$null | Out-Null }
Diga "Parando servicos..."; Svc stop "RegemEdgeApi"; Svc stop "RegemEdgeSync"; Svc stop "RegemEdgeImpressao"; Svc stop "RegemEdgeWeb"

try {
  # ---- restaura codigo (dist) ----
  $distAtual = Join-Path $Raiz "dist"
  if (Test-Path $distAtual) { Remove-Item $distAtual -Recurse -Force }
  Copy-Item $distBak $distAtual -Recurse -Force
  Diga "Codigo (dist) restaurado."

  # ---- restaura app (web), se o backup tiver ----
  if (Test-Path $webBak) {
    $webAtual = Join-Path $Raiz "web"
    if (Test-Path $webAtual) { Remove-Item $webAtual -Recurse -Force }
    Copy-Item $webBak $webAtual -Recurse -Force
    Diga "App (web) restaurado."
  } else {
    Diga "(aviso) backup sem 'web' - so o backend foi revertido."
  }

  # ---- banco: SO com -ComBanco (destrutivo: descarta o que rodou apos a atualizacao) ----
  if ($ComBanco) {
    $pgrestore = (Get-Command pg_restore -ErrorAction SilentlyContinue)
    if ($pgrestore -and (Test-Path $dumpFile) -and $cfg.EDGE_DATABASE_URL) {
      Diga "Restaurando banco do backup (--clean)..."
      & $pgrestore.Source --clean --if-exists --no-owner --dbname $cfg.EDGE_DATABASE_URL $dumpFile
      if ($LASTEXITCODE -ne 0) { Diga "(aviso) pg_restore terminou com codigo $LASTEXITCODE." }
    } else {
      Diga "(aviso) -ComBanco pedido, mas pg_restore/db.dump/EDGE_DATABASE_URL ausente. Banco NAO restaurado."
    }
  } else {
    Diga "Banco mantido (rollback so de codigo). Para reverter o banco: reverter.ps1 -ComBanco"
  }

  Diga "Subindo servicos..."; Svc start "RegemEdgeApi"; Svc start "RegemEdgeSync"; Svc start "RegemEdgeImpressao"; Svc start "RegemEdgeWeb"

  # ---- health-check /ping (ate ~40s) ----
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
      try { $c = New-Object System.Net.Sockets.TcpClient; $c.Connect('localhost', [int]$porta); if ($c.Connected) { $ok = $true }; $c.Close() } catch {}
      if ($ok) { break }
    }
  }
  if (-not $ok) { Diga "(aviso) health-check /ping nao respondeu 200 - confira os logs dos servicos." }
  else { Diga "OK! Versao anterior restaurada e servicos no ar." }
}
catch {
  Diga "ERRO no rollback: $($_.Exception.Message)"
  Svc start "RegemEdgeApi"; Svc start "RegemEdgeSync"; Svc start "RegemEdgeImpressao"; Svc start "RegemEdgeWeb"
  throw
}
