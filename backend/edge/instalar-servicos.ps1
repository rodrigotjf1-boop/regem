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
  [string]$Node = "node",
  [string]$Nssm = "nssm",
  [int]$PortaWeb = 3001,   # App (Next) - HTTPS publico na LAN
  [int]$PortaApi = 3002    # API (NestJS) - atras do app
)

$ErrorActionPreference = "Stop"

# Resolve node e nssm do bundle (ao lado de backend/) — o PC da loja nao os tem no
# PATH. Cai para o PATH so se nao houver embutido.
$bundle = Split-Path $Raiz -Parent
$bNode = Join-Path $bundle "node\node.exe"
$bNssm = Join-Path $bundle "nssm\nssm.exe"
if     (Test-Path $bNode)                                   { $nodeExe = $bNode }
elseif (Get-Command $Node -ErrorAction SilentlyContinue)    { $nodeExe = (Get-Command $Node).Source }
else   { throw "Node nao encontrado (nem no bundle $bNode nem no PATH)." }
if (-not (Test-Path $Nssm)) { if (Test-Path $bNssm) { $Nssm = $bNssm } }
if ($Nssm -eq "nssm" -and -not (Get-Command nssm -ErrorAction SilentlyContinue)) {
  throw "NSSM nao encontrado (nem no bundle $bNssm nem no PATH)."
}

# NAO usar $args como nome de parametro: e variavel automatica do PowerShell e
# nao recebe o valor posicional (o servico subiria node.exe SEM script -> REPL).
function Svc($nome, $appArgs, $cwd) {
  Write-Host "-> Servico $nome"
  & $Nssm install $nome $nodeExe | Out-Null
  & $Nssm set $nome AppParameters $appArgs | Out-Null
  & $Nssm set $nome AppDirectory $cwd | Out-Null
  & $Nssm set $nome Start SERVICE_AUTO_START | Out-Null
  & $Nssm set $nome AppStdout "$cwd\logs\$nome.log" | Out-Null
  & $Nssm set $nome AppStderr "$cwd\logs\$nome.err.log" | Out-Null
  & $Nssm set $nome AppRotateFiles 1 | Out-Null
  & $Nssm set $nome AppRotateBytes 10485760 | Out-Null
}

New-Item -ItemType Directory -Force "$Raiz\logs" | Out-Null

# Backend local (serve a LAN). Usa dist/main.js (rode `npm run build` antes).
Svc "RegemEdgeApi" "$Raiz\dist\main.js" $Raiz

# Daemon de sync (nuvem <-> local).
Svc "RegemEdgeSync" "$Raiz\edge\sync-daemon.mjs" $Raiz

# Worker de impressao termica (fila local -> impressoras ESC/POS na LAN).
Svc "RegemEdgeImpressao" "$Raiz\edge\impressao-daemon.mjs" $Raiz

# App (Next standalone) servido por HTTPS via edge-web.mjs. PORT = HTTPS publico;
# WEB_INNER_PORT = HTTP interno do Next (so localhost). Ambos precisam vir da env
# do servico (o edge-web nao sobrescreve envs ja definidas).
Svc "RegemEdgeWeb" "$Raiz\edge\edge-web.mjs" $Raiz
& $Nssm set RegemEdgeWeb AppEnvironmentExtra "PORT=$PortaWeb" "WEB_INNER_PORT=3011" | Out-Null

# Libera as portas do app e da API só na rede local (nunca expostas à internet).
try {
  New-NetFirewallRule -DisplayName "Regem Edge (LAN)" -Direction Inbound -Action Allow `
    -Protocol TCP -LocalPort @($PortaWeb, $PortaApi) -Profile Private,Domain -ErrorAction Stop | Out-Null
  Write-Host "→ Firewall: portas $PortaWeb (app) e $PortaApi (API) liberadas (perfil Privado/Domínio)"
} catch { Write-Warning "Não consegui criar a regra de firewall: $_" }

& $Nssm start RegemEdgeApi
& $Nssm start RegemEdgeSync
& $Nssm start RegemEdgeImpressao
& $Nssm start RegemEdgeWeb

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

Write-Host "`nPronto. Serviços RegemEdgeApi + RegemEdgeSync + RegemEdgeImpressao + RegemEdgeWeb ativos e no boot."
Write-Host "App:  https://localhost:$PortaWeb    API: https://localhost:$PortaApi/api/v1/ping"
