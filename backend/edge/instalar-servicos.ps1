# Regem Edge — registra backend + daemon de sync como SERVIÇOS do Windows (NSSM),
# para subirem sozinhos no boot, sem terminal aberto.
#
# Pré-requisitos: Node 20+, NSSM no PATH (https://nssm.cc), a pasta do edge já
# preparada (npm ci + npm run build) e o backend/.env.local configurado.
#
# Uso (PowerShell como Administrador):
#   .\instalar-servicos.ps1 -Raiz "C:\regem-edge\backend"
param(
  [string]$Raiz = "C:\regem-edge\backend",
  [string]$Node = "node"
)

$ErrorActionPreference = "Stop"
$nodeExe = (Get-Command $Node).Source

function Svc($nome, $args, $cwd) {
  Write-Host "→ Serviço $nome"
  nssm install $nome $nodeExe $args | Out-Null
  nssm set $nome AppDirectory $cwd | Out-Null
  nssm set $nome Start SERVICE_AUTO_START | Out-Null
  nssm set $nome AppStdout "$cwd\logs\$nome.log" | Out-Null
  nssm set $nome AppStderr "$cwd\logs\$nome.err.log" | Out-Null
  nssm set $nome AppRotateFiles 1 | Out-Null
  nssm set $nome AppRotateBytes 10485760 | Out-Null
}

New-Item -ItemType Directory -Force "$Raiz\logs" | Out-Null

# Backend local (serve a LAN). Usa dist/main.js (rode `npm run build` antes).
Svc "RegemEdgeApi" "$Raiz\dist\main.js" $Raiz

# Daemon de sync (nuvem <-> local).
Svc "RegemEdgeSync" "$Raiz\edge\sync-daemon.mjs" $Raiz

# Libera a porta 3001 só na rede local (nunca exposta à internet pelo Windows).
try {
  New-NetFirewallRule -DisplayName "Regem Edge 3001 (LAN)" -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort 3001 -Profile Private,Domain -ErrorAction Stop | Out-Null
  Write-Host "→ Firewall: porta 3001 liberada (perfil Privado/Domínio)"
} catch { Write-Warning "Não consegui criar a regra de firewall: $_" }

nssm start RegemEdgeApi
nssm start RegemEdgeSync

# Auto-update (Fase E-D): tarefa agendada que roda o atualizar.ps1 todo dia de
# madrugada. Ele só aplica se houver versão nova (com backup + rollback); se não,
# sai em silêncio. Roda como SYSTEM (privilégio para parar/subir os serviços).
try {
  $atualizar = Join-Path $Raiz "edge\atualizar.ps1"
  if (Test-Path $atualizar) {
    $acao = New-ScheduledTaskAction -Execute "powershell.exe" `
      -Argument ("-ExecutionPolicy Bypass -NoProfile -File `"{0}`" -Raiz `"{1}`"" -f $atualizar, $Raiz)
    $gatilho = New-ScheduledTaskTrigger -Daily -At 4am
    $conta = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
    $cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd
    Register-ScheduledTask -TaskName "RegemEdgeUpdate" -Action $acao -Trigger $gatilho `
      -Principal $conta -Settings $cfg -Force | Out-Null
    Write-Host "→ Auto-update agendado (RegemEdgeUpdate, 04:00 diário)."
  }
} catch { Write-Warning "Não consegui criar o agendamento de auto-update: $_" }

Write-Host "`nPronto. Serviços RegemEdgeApi + RegemEdgeSync ativos e no boot."
Write-Host "Confira: http(s)://localhost:3001/api/v1/ping"
