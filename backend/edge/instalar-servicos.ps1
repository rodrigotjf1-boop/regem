# Regem Edge - registra backend + daemon de sync como SERVIÇOS do Windows (NSSM),
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

# Resolve node e nssm do bundle (ao lado de backend/) - o PC da loja nao os tem no
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
  # LE-4 (auditoria ago/2026): rodar os servicos como NetworkService (baixo privilegio)
  # ficou ADIADO. No teste de campo eles cairam como NetworkService (SERVICE_PAUSED, sem
  # nem escrever .err.log) -> a conta nao lia o codigo (dist/edge) nem escrevia em logs\.
  # Fazer isso exige um passo dedicado que garanta, ANTES do start, NetworkService com
  # leitura em dist/edge/node/certs e escrita em logs\ — e teste em instalacao real.
  # Por ora fica no DEFAULT do NSSM (LocalSystem), que funciona; a conta de baixo
  # privilegio entra na rodada testada junto com LE-5/LE-2/LE-3. Ver docs/seguranca-remediacao.
  & $Nssm set $nome Start SERVICE_AUTO_START | Out-Null
  # Recuperacao (E1): em QUALQUER saida do processo, reinicia; AppThrottle + AppRestartDelay
  # evitam CRASH-LOOP apertado (ex.: excecao no boot). Os daemons agora saem(1) em
  # uncaughtException, entao o NSSM precisa reiniciar de forma controlada (5s de janela de
  # "start rapido demais" + 3s de espera antes de subir de novo).
  & $Nssm set $nome AppExit Default Restart | Out-Null
  & $Nssm set $nome AppThrottle 5000 | Out-Null
  & $Nssm set $nome AppRestartDelay 3000 | Out-Null
  & $Nssm set $nome AppStdout "$cwd\logs\$nome.log" | Out-Null
  & $Nssm set $nome AppStderr "$cwd\logs\$nome.err.log" | Out-Null
  & $Nssm set $nome AppRotateFiles 1 | Out-Null
  # AppRotateOnline 1: rotaciona ENQUANTO o serviço roda (senão o NSSM só rotaciona no
  # restart -> o log do Postgres, dias no ar, crescia sem parar, ex.: 111 MB). Com isto,
  # cada .log/.err.log é cortado ao passar de 10 MB mesmo com o serviço em execução.
  & $Nssm set $nome AppRotateOnline 1 | Out-Null
  & $Nssm set $nome AppRotateBytes 10485760 | Out-Null
  # Postgres loga checkpoint a cada 5 min (volume principal do .err.log). Desligar reduz
  # MUITO o crescimento — mantém só avisos/erros. Best-effort (append no postgresql.conf).
  if ($nome -eq 'RegemEdgePg') {
    try {
      $pgConf = Join-Path (Split-Path $cwd -Parent) 'pgdata\postgresql.conf'
      if (Test-Path $pgConf -PathType Leaf) {
        $confTxt = Get-Content $pgConf -Raw
        if ($confTxt -notmatch '(?m)^\s*log_checkpoints\s*=\s*off') {
          Add-Content -Path $pgConf -Value "`nlog_checkpoints = off  # Regem: reduz volume do log (checkpoints)"
        }
      }
    } catch {}
  }
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
  Write-Host "-> Firewall: portas $PortaWeb (app) e $PortaApi (API) liberadas (perfil Privado/Domínio)"
} catch { Write-Warning "Não consegui criar a regra de firewall: $_" }

# Dependências de serviço (boot limpo): os serviços node dependem do Postgres local
# (RegemEdgePg); o Web depende da API. Sem isto, no boot eles sobem ANTES do Postgres e
# falham a 1ª query (o retry/timeout salva, mas é sujo). Best-effort e GUARDADO: só amarra
# se o RegemEdgePg já existe (a instalação completa o registra antes deste script — l.702
# do instalar-tudo; uma execução avulsa sem PG não trava a partida dos serviços node).
if (Get-Service -Name RegemEdgePg -ErrorAction SilentlyContinue) {
  foreach ($s in @('RegemEdgeApi', 'RegemEdgeSync', 'RegemEdgeImpressao')) {
    & $Nssm set $s DependOnService RegemEdgePg | Out-Null
  }
  & $Nssm set RegemEdgeWeb DependOnService RegemEdgeApi | Out-Null
  Write-Host "-> Dependências: Api/Sync/Impressao → RegemEdgePg; Web → RegemEdgeApi"
}

& $Nssm start RegemEdgeApi
& $Nssm start RegemEdgeSync
& $Nssm start RegemEdgeImpressao
& $Nssm start RegemEdgeWeb

# Auto-update SOB DEMANDA: tarefa que roda o atualizar.ps1 como SYSTEM (privilégio
# para parar/subir serviços e trocar arquivos). SEM gatilho de horário - a
# atualização NUNCA é aplicada sozinha; quem dispara é o gestor pelo botão do app
# ("Instalar atualização"), que chama `schtasks /run /tn RegemEdgeUpdate`. A
# VERIFICAÇÃO (notificar que há versão nova) é feita pelo sync-daemon nos horários
# de abertura da loja.
try {
  $atualizar = Join-Path $Raiz "edge\atualizar.ps1"
  if (Test-Path $atualizar) {
    $acao = New-ScheduledTaskAction -Execute "powershell.exe" `
      -Argument ("-ExecutionPolicy Bypass -NoProfile -File `"{0}`" -Raiz `"{1}`"" -f $atualizar, $Raiz)
    $conta = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
    # -ExecutionTimeLimit PT15M: se a execução travar (ex.: pg_dump pendurado), o
    # Windows mata a tarefa sozinho após 15 min — não fica "Running" por dias
    # ("nada acontece"). NÃO usar -MultipleInstances StopExisting: esse nome de enum
    # NÃO existe em todas as versões do Windows/PowerShell (só Parallel/Queue/IgnoreNew)
    # e, quando ausente, FAZ O Register-ScheduledTask INTEIRO FALHAR (a tarefa nem é
    # criada). O "matar a execução presa antes de re-disparar" é feito pelo
    # edge.service.aplicarAtualizacao (schtasks /end antes do /run), que é portável.
    $cfg = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
    Register-ScheduledTask -TaskName "RegemEdgeUpdate" -Action $acao `
      -Principal $conta -Settings $cfg -Force | Out-Null
    Write-Host "-> Auto-update registrado SOB DEMANDA (RegemEdgeUpdate) - disparado pelo botão do app."
  }
} catch { Write-Warning "Não consegui registrar a tarefa de update: $_" }

# ROLLBACK SOB DEMANDA: tarefa que roda o reverter.ps1 como SYSTEM (restaura o
# ultimo backup - dist/web - da versao anterior). Disparado pelo botão do app
# ("Reverter atualização"), que chama `schtasks /run /tn RegemEdgeRollback`.
try {
  $reverter = Join-Path $Raiz "edge\reverter.ps1"
  if (Test-Path $reverter) {
    $acaoR = New-ScheduledTaskAction -Execute "powershell.exe" `
      -Argument ("-ExecutionPolicy Bypass -NoProfile -File `"{0}`" -Raiz `"{1}`"" -f $reverter, $Raiz)
    $contaR = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
    $cfgR = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
      -ExecutionTimeLimit (New-TimeSpan -Minutes 15)
    Register-ScheduledTask -TaskName "RegemEdgeRollback" -Action $acaoR `
      -Principal $contaR -Settings $cfgR -Force | Out-Null
    Write-Host "-> Rollback registrado SOB DEMANDA (RegemEdgeRollback) - disparado pelo botão do app."
  }
} catch { Write-Warning "Não consegui registrar a tarefa de rollback: $_" }

Write-Host "`nPronto. Serviços RegemEdgeApi + RegemEdgeSync + RegemEdgeImpressao + RegemEdgeWeb ativos e no boot."
Write-Host "App:  https://localhost:$PortaWeb    API: https://localhost:$PortaApi/api/v1/ping"
