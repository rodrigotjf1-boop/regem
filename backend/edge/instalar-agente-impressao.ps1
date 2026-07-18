# Regem — instala o AGENTE DE IMPRESSÃO como serviço do Windows (RegemImpressoraAgente).
# Para lojas em MODO NUVEM (sem o edge completo) que têm impressora local (USB/rede).
# O agente puxa os jobs da nuvem e imprime na térmica local.
#
# Requisitos: Node.js instalado (ou informe -NodeExe) e NSSM (ou informe -Nssm).
# Os arquivos do agente (print-agent.mjs, escpos.mjs, raw-print.ps1) devem estar em -Pasta.
#
# Uso (PowerShell como Administrador):
#   .\instalar-agente-impressao.ps1 -CloudApi "https://api.dmsregem.com/api/v1" `
#       -SyncToken "<token da loja>" -Pasta "C:\regem-agente"
param(
  [Parameter(Mandatory = $true)][string]$CloudApi,
  [Parameter(Mandatory = $true)][string]$SyncToken,
  [string]$Pasta = $PSScriptRoot,
  [string]$NodeExe = "",
  [string]$Nssm = ""
)
$ErrorActionPreference = "Stop"

# Resolve node e nssm (usa os embutidos do edge se existirem ao lado).
$edgeBase = Split-Path $Pasta -Parent
if (-not $NodeExe) {
  if (Test-Path (Join-Path $edgeBase 'node\node.exe')) { $NodeExe = Join-Path $edgeBase 'node\node.exe' }
  else { $NodeExe = (Get-Command node -ErrorAction SilentlyContinue).Source }
}
if (-not $NodeExe) { throw "Node.js nao encontrado. Instale o Node ou informe -NodeExe." }
if (-not $Nssm) {
  if (Test-Path (Join-Path $edgeBase 'nssm\nssm.exe')) { $Nssm = Join-Path $edgeBase 'nssm\nssm.exe' }
  else { $Nssm = (Get-Command nssm -ErrorAction SilentlyContinue).Source }
}
if (-not $Nssm) { throw "NSSM nao encontrado. Baixe o nssm.exe ou informe -Nssm." }

$agente = Join-Path $Pasta "print-agent.mjs"
if (-not (Test-Path $agente)) { throw "print-agent.mjs nao encontrado em $Pasta" }

# Grava o .env do agente (CLOUD_API + SYNC_TOKEN).
$envFile = Join-Path $Pasta ".env"
@(
  "CLOUD_API=$CloudApi"
  "SYNC_TOKEN=$SyncToken"
) | Set-Content -Path $envFile -Encoding UTF8
Write-Host "-> Config gravada em $envFile"

# (Re)registra o serviço.
$logDir = Join-Path $Pasta "logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
& $Nssm stop RegemImpressoraAgente 2>$null | Out-Null
& $Nssm remove RegemImpressoraAgente confirm 2>$null | Out-Null
& $Nssm install RegemImpressoraAgente $NodeExe $agente | Out-Null
& $Nssm set RegemImpressoraAgente AppDirectory $Pasta | Out-Null
& $Nssm set RegemImpressoraAgente Start SERVICE_AUTO_START | Out-Null
& $Nssm set RegemImpressoraAgente AppStdout (Join-Path $logDir "agente-impressao.log") | Out-Null
& $Nssm set RegemImpressoraAgente AppStderr (Join-Path $logDir "agente-impressao.err.log") | Out-Null
& $Nssm start RegemImpressoraAgente | Out-Null

Write-Host "OK! Servico RegemImpressoraAgente instalado e iniciado."
Write-Host "Ele imprime os jobs da loja na termica local (USB/rede). Logs em $logDir."
