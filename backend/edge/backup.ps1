# Regem Edge — BACKUP agendado do banco local, cifrado em repouso (DPAPI LocalMachine).
# Rodado por tarefa diaria (registrada pelo instalar-tudo.ps1 no modo servidor).
#   pg_dump --format=custom  ->  cifra com DPAPI (so decifra NESTA maquina)  ->  backups\
# Retencao configuravel (padrao 14 dias).
#
# OBS de DR: este backup e para recuperacao LOCAL (corrupcao/rollback na mesma maquina).
# Para "servidor queimou" (maquina nova), a restauracao vem da NUVEM (sync/restore), pois
# o blob DPAPI nao decifra em outra maquina — ver docs/roadmap-seguranca-migracao.md §5.
param([string]$Raiz = "C:\regem-edge\backend", [int]$Reter = 14)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

function DecDpapi($v) {
  if ($v -notlike 'enc:*') { return $v }
  $b = [Convert]::FromBase64String($v.Substring(4))
  $p = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'LocalMachine')
  return [Text.Encoding]::UTF8.GetString($p)
}

$envF = Join-Path $Raiz ".env.local"
if (-not (Test-Path $envF)) { throw ".env.local nao encontrado: $envF" }
$cfg = @{}
foreach ($l in Get-Content $envF) { if ($l -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() } }
$dburl = DecDpapi $cfg.EDGE_DATABASE_URL
if (-not $dburl) { throw "EDGE_DATABASE_URL ausente no .env.local." }

$bakDir = Join-Path (Split-Path $Raiz -Parent) "backups"
New-Item -ItemType Directory -Force $bakDir | Out-Null
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"
$tmp = Join-Path $env:TEMP ("regem-bak-{0}.dump" -f $stamp)

$pgdump = (Get-Command pg_dump -ErrorAction SilentlyContinue)
if (-not $pgdump) {
  $embed = Join-Path (Split-Path $Raiz -Parent) 'pgsql\bin\pg_dump.exe'
  if (Test-Path $embed) { $pgdump = [pscustomobject]@{ Source = $embed } } else { throw "pg_dump nao encontrado (nem no PATH nem embutido)." }
}
& $pgdump.Source --format=custom --file $tmp $dburl
if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou (rc=$LASTEXITCODE)." }

# Cifra o dump com DPAPI (LocalMachine): em repouso fica ilegivel sem esta maquina.
$bytes = [IO.File]::ReadAllBytes($tmp)
$enc = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'LocalMachine')
$destino = Join-Path $bakDir ("db-{0}.dump.enc" -f $stamp)
[IO.File]::WriteAllBytes($destino, $enc)
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

# Retencao: remove backups mais antigos que -Reter dias.
Get-ChildItem $bakDir -Filter 'db-*.dump.enc' -ErrorAction SilentlyContinue |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Reter) } |
  Remove-Item -Force -ErrorAction SilentlyContinue

Write-Host ("Backup cifrado: {0} (retencao {1}d)" -f (Split-Path $destino -Leaf), $Reter)
