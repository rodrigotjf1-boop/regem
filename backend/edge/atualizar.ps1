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
Diga "Nova versao: $($info.ultima). Baixando $($info.url)"

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
$novo = Join-Path $tmp "novo"
Expand-Archive -Path $zip -DestinationPath $novo -Force

# ---- 3) BACKUP (banco + codigo) ----
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

# ---- 4) para servicos, troca arquivos, migra, sobe ----
function Svc($acao, $nome) { & $nssmExe $acao $nome 2>$null | Out-Null }
Diga "Parando servicos..."; Svc stop "RegemEdgeApi"; Svc stop "RegemEdgeSync"

try {
  Diga "Trocando arquivos (dist, migrations, scripts, package)..."
  foreach ($item in @("dist", "database", "scripts", "package.json", "package-lock.json")) {
    $de  = Join-Path $novo $item
    $para = Join-Path $Raiz $item
    if (Test-Path $de) {
      if (Test-Path $para) { Remove-Item $para -Recurse -Force }
      Copy-Item $de $para -Recurse -Force
    }
  }
  Diga "npm ci (caso deps tenham mudado)..."
  Push-Location $Raiz; npm ci --omit=dev; $ciCode = $LASTEXITCODE; Pop-Location
  if ($ciCode -ne 0) { throw "npm ci falhou." }

  Diga "Aplicando migrations locais..."
  Push-Location $Raiz; node scripts\apply-all-local.mjs; $mgCode = $LASTEXITCODE; Pop-Location
  if ($mgCode -ne 0) { throw "migrations falharam." }

  Diga "Subindo servicos..."; Svc start "RegemEdgeApi"; Svc start "RegemEdgeSync"

  # ---- 5) HEALTH-CHECK (ate ~40s) ----
  $porta = if ($cfg.PORT) { $cfg.PORT } else { "3001" }
  $ok = $false
  foreach ($i in 1..20) {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest -Uri ("https://localhost:{0}/api/v1/ping" -f $porta) -TimeoutSec 5 -SkipCertificateCheck
      if ($r.StatusCode -eq 200) { $ok = $true; break }
    } catch { }
  }
  if (-not $ok) { throw "Health-check /ping falhou apos a troca." }

  Diga "OK! Atualizado para $($info.ultima). Backup em: $bakDir"
  Diga "IMPORTANTE: atualize APP_VERSION=$($info.ultima) no .env.local (o heartbeat/telemetria usa isso)."
}
catch {
  Diga "ERRO: $($_.Exception.Message)"
  Diga "ROLLBACK do codigo (dist.bak)..."
  Svc stop "RegemEdgeApi"; Svc stop "RegemEdgeSync"
  if (Test-Path $distBak) {
    if (Test-Path $distAtual) { Remove-Item $distAtual -Recurse -Force }
    Copy-Item $distBak $distAtual -Recurse -Force
  }
  Svc start "RegemEdgeApi"; Svc start "RegemEdgeSync"
  Diga "Codigo restaurado. Se a migration ja rodou e o problema for o banco, restaure manualmente:"
  Diga "   pg_restore --clean --dbname `"$($cfg.EDGE_DATABASE_URL)`" `"$dumpFile`""
  throw
}
finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
