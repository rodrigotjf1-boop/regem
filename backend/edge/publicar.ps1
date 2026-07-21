# Regem Edge — PUBLICAR uma nova versão (rode na SUA máquina de dev).
#
# O que faz: compila o backend, monta o pacote (regem-edge-dist), zipa numa
# versão e calcula o SHA-256. No fim, mostra as 3 variáveis para colar no
# regem-api (nuvem) — é assim que o edge de cada loja "descobre" a versão nova.
#
# Uso (PowerShell, na pasta backend/):
#   .\edge\publicar.ps1 -Versao 1.4.0
#   .\edge\publicar.ps1 -Versao 1.4.0 -SkipBuild   # se já rodou npm run build
#
# Depois: suba o .zip para um lugar acessível pela LOJA (um storage/URL HTTPS)
# e cole no regem-api as 3 variáveis impressas (EDGE_LATEST_VERSION / _URL / _SHA256).
param(
  [Parameter(Mandatory = $true)][string]$Versao,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$backend = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path  # ...\backend
Set-Location $backend

if (-not $SkipBuild) {
  Write-Host "→ Compilando backend (npm run build)…"
  npm run build
  if ($LASTEXITCODE -ne 0) { throw "npm run build falhou." }
}

Write-Host "→ Montando pacote (node edge/package.mjs)…"
node edge/package.mjs
if ($LASTEXITCODE -ne 0) { throw "package.mjs falhou." }

$dist = (Resolve-Path (Join-Path $backend "..\regem-edge-dist")).Path
$zip  = Join-Path (Split-Path $dist -Parent) ("regem-edge-{0}.zip" -f $Versao)

if (Test-Path $zip) { Remove-Item $zip -Force }
Write-Host "→ Zipando $dist → $zip (sem node_modules — o atualizar.ps1 roda npm ci)"
# node_modules fica FORA do zip de update: o atualizar.ps1 restaura as deps com
# npm ci. So o instalador .exe embute node_modules (para instalar offline).
$itens = Get-ChildItem -Path $dist -Force | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object { $_.FullName }
Compress-Archive -Path $itens -DestinationPath $zip -CompressionLevel Optimal

$sha = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()

Write-Host ""
Write-Host "==================== PRONTO ====================" -ForegroundColor Green
Write-Host ("Pacote: {0}" -f $zip)
Write-Host ("SHA256: {0}" -f $sha)
Write-Host ""
Write-Host "1) Suba o .zip para um endereço HTTPS que a LOJA consiga baixar."
Write-Host "2) No regem-api (EasyPanel), defina/atualize estas variáveis e reinicie:"
Write-Host ""
Write-Host ("   EDGE_LATEST_VERSION={0}" -f $Versao)   -ForegroundColor Cyan
Write-Host  "   EDGE_UPDATE_URL=https://SEU-STORAGE/regem-edge-$Versao.zip" -ForegroundColor Cyan
Write-Host ("   EDGE_UPDATE_SHA256={0}" -f $sha)       -ForegroundColor Cyan
Write-Host ("   EDGE_UPDATE_NOTAS=descreva a mudanca") -ForegroundColor Cyan
Write-Host ""
Write-Host "Cada loja detecta em ate 1h (log '⬆️ atualizacao disponivel') e aplica com edge\atualizar.ps1."
