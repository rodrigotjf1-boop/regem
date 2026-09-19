# Regem Edge - APLICAR atualizacao no PC da LOJA.
#
# Fluxo (modelo "monta ao lado e troca o conjunto", como Velopack/Squirrel e A/B do Android):
#   PREPARACAO (a loja segue operando; nada instalado e tocado)
#     1) pergunta a nuvem (/edge/update-check, com o token do servidor -> piloto/percentual)
#     2) confere a ASSINATURA Ed25519 (obrigatoria quando edge\update-pub.pem existe)
#     3) baixa o .zip, confere o SHA-256, monta a versao nova INTEIRA em ..\atualizacao-<versao>\
#        (dependencias ja vem no pacote: node_modules.tar; nada de npm ci na loja - ERR-045)
#     4) backup do banco (cifrado com DPAPI - ERR-050)
#   TROCA (servicos parados por 1-2 min)
#     5) renomeia o conjunto atual para backup-<data>\ e o novo para o lugar (ERR-047)
#     6) migrations com a conexao DECIFRADA (antes falhavam em loja protegida - ERR-056)
#     7) sobe os servicos e confere a SAUDE: /ping na versao nova + 4 servicos de pe, e de novo
#        30 s depois (ERR-048)
#   FALHA NA TROCA -> volta o conjunto inteiro, APP_VERSION e os scripts do edge, e sobe de novo.
#
# Rode como Administrador (normalmente pela tarefa SYSTEM RegemEdgeUpdate):
#   .\edge\atualizar.ps1 -Raiz "C:\regem-edge\backend"  [-Forcar]
param(
  [string]$Raiz = "C:\regem-edge\backend",
  [switch]$Forcar
)

$ErrorActionPreference = "Stop"
$script:Raiz = $Raiz
$script:logDir = Join-Path $Raiz "logs"
New-Item -ItemType Directory -Force $script:logDir | Out-Null
$script:log = Join-Path $script:logDir ("atualizar-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$script:statusFile = Join-Path $script:logDir "update-status.json"
. (Join-Path $PSScriptRoot 'atualizacao-comum.ps1')

$script:versaoNova = ""
$script:baixadoMb = $null
$script:totalMb = $null
$script:acaoFinal = $null
# fase: 'baixando' | 'instalando' | 'ok' | 'erro' - a tela mostra uma barra por fase.
function Prog($estagio, $pct, $fase = 'instalando', $erro = $null) {
  Grava-Status @{
    fase = $fase; estagio = $estagio; pct = $pct; versao = $script:versaoNova
    baixadoMb = $script:baixadoMb; totalMb = $script:totalMb; acaoFinal = $script:acaoFinal; erro = $erro
  }
}

# ---- trava: uma atualizacao/reversao por vez ----
$trava = Obter-Trava (Join-Path $script:logDir 'atualizacao.lock')
if (-not $trava) {
  Diga "Outra atualizacao ou reversao ja esta rodando - saindo sem mexer em nada."
  exit 1
}

# Node/Postgres/NSSM EMBUTIDOS (a tarefa roda como SYSTEM, sem o PATH do usuario).
$edgeBase = Split-Path $Raiz -Parent
if (Test-Path (Join-Path $edgeBase 'node\node.exe')) { $env:Path = (Join-Path $edgeBase 'node') + ';' + $env:Path }
if (Test-Path (Join-Path $edgeBase 'pgsql\bin'))     { $env:Path = (Join-Path $edgeBase 'pgsql\bin') + ';' + $env:Path }
$script:nssmExe = if (Test-Path (Join-Path $edgeBase 'nssm\nssm.exe')) { Join-Path $edgeBase 'nssm\nssm.exe' } else { 'nssm' }
$script:nodeExe = if (Test-Path (Join-Path $edgeBase 'node\node.exe')) { Join-Path $edgeBase 'node\node.exe' } else { 'node' }

$envFile = Join-Path $Raiz ".env.local"
$stage = $null
$bakDir = $null
$diario = New-Object System.Collections.Generic.List[object]   # o que a troca ja fez (para desfazer)
$trocou = $false

try {
  Prog "iniciando" 0 'baixando'
  if (-not (Test-Path $envFile)) { throw ".env.local nao encontrado em $Raiz" }
  $cfg = Ler-Env $envFile
  $versaoAtual = if ($cfg.APP_VERSION) { $cfg.APP_VERSION } else { "0" }
  $cloud = "$($cfg.CLOUD_API)".TrimEnd("/")
  if (-not $cloud) { throw "CLOUD_API ausente no .env.local" }
  $porta = if ($cfg.PORT) { $cfg.PORT } else { "3001" }

  # ================= PREPARACAO (nada instalado e tocado) =================
  Diga "Versao instalada: $versaoAtual - consultando a nuvem..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $cab = @{}
  if ($cfg.SYNC_TOKEN -and -not $cfg.SYNC_TOKEN.StartsWith('enc:')) { $cab['x-sync-token'] = $cfg.SYNC_TOKEN }
  $info = Invoke-RestMethod -Uri ("{0}/edge/update-check?versao={1}" -f $cloud, $versaoAtual) -Headers $cab -TimeoutSec 30
  if (-not $info.atualizar -and -not $Forcar) { Diga "Ja esta na ultima versao liberada para esta loja ($($info.ultima))."; Prog "ok" 100 'ok'; return }
  if (-not $info.url)    { throw "A nuvem nao informou o pacote (url) - nada para baixar." }
  if (-not $info.sha256) { throw "A nuvem nao informou o SHA-256 - recusando por seguranca." }
  $script:versaoNova = "$($info.ultima)"
  if ($script:versaoNova -notmatch '^\d+\.\d+\.\d+$') { throw "Versao recebida invalida: '$($script:versaoNova)'." }

  # anti-downgrade (recusa versao MENOR, mesmo com -Forcar)
  function VerNum($v) { ,@(($v -split '\.') | ForEach-Object { [int]($_ -replace '\D', '') }) }
  $vn = VerNum $script:versaoNova; $va = VerNum $versaoAtual
  for ($i = 0; $i -lt [Math]::Max($vn.Count, $va.Count); $i++) {
    $x = if ($i -lt $vn.Count) { $vn[$i] } else { 0 }
    $y = if ($i -lt $va.Count) { $va[$i] } else { 0 }
    if ($x -lt $y) { throw "Downgrade BLOQUEADO: nova ($($script:versaoNova)) < instalada ($versaoAtual)." }
    if ($x -gt $y) { break }
  }

  # ---- ASSINATURA (ERR-046) ----
  # Com a chave publica instalada (edge\update-pub.pem), a assinatura e OBRIGATORIA - v2, com
  # validade. EDGE_REQUIRE_SIGNED_UPDATE=false (gravado pelos instaladores antigos) NAO desliga
  # mais nada; so EDGE_ALLOW_UNSIGNED_UPDATE=true (bancada de teste) tolera pacote sem assinatura.
  $temChave = Test-Path (Join-Path $Raiz 'edge\update-pub.pem')
  $exigir = $temChave -and ($cfg.EDGE_ALLOW_UNSIGNED_UPDATE -ne 'true')
  $verif = Join-Path $Raiz 'edge\verify-update.mjs'
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  if ($info.assinaturaV2 -and $info.expiraEm) {
    & $script:nodeExe $verif $script:versaoNova $info.sha256 $info.url $info.assinaturaV2 $info.expiraEm 2>&1 | ForEach-Object { Diga "  $_" }
    $rc = $LASTEXITCODE; $tipoSig = 'v2'
  } elseif ($info.assinatura -and -not $exigir) {
    & $script:nodeExe $verif $script:versaoNova $info.sha256 $info.url $info.assinatura 2>&1 | ForEach-Object { Diga "  $_" }
    $rc = $LASTEXITCODE; $tipoSig = 'v1'
  } else {
    $rc = 2; $tipoSig = 'nenhuma'
  }
  $ErrorActionPreference = $ea
  if ($rc -eq 0) { Diga "Assinatura do release confere (Ed25519 $tipoSig)." }
  elseif ($rc -eq 1) { throw "Assinatura do release INVALIDA - recusando (possivel adulteracao do canal de release)." }
  elseif ($rc -eq 3) { throw "Assinatura do release VENCIDA - a distribuicao precisa assinar de novo." }
  elseif ($exigir) { throw "Release sem assinatura v2 valida e este servidor exige assinatura - recusando." }
  else { Diga "(aviso) assinatura nao verificada ($tipoSig; sem chave publica neste servidor) - tolerando." }

  # ---- download (stream, barra real, teto de tamanho) ----
  Diga "Nova versao: $($script:versaoNova). Baixando o pacote..."
  Prog "baixando" 0 'baixando'
  Get-ChildItem -LiteralPath $edgeBase -Directory -Filter 'atualizacao-*' -ErrorAction SilentlyContinue |
    ForEach-Object { Apagar-Pasta $_.FullName }   # restos de tentativa anterior
  $stage = Join-Path $edgeBase ("atualizacao-{0}" -f $script:versaoNova)
  New-Item -ItemType Directory -Force $stage | Out-Null
  $zip = Join-Path $stage "pacote.zip"
  $TETO = [int64]800MB   # um "download sem fim" nao enche o disco da loja
  $reqDl = [System.Net.HttpWebRequest]::Create($info.url)
  $reqDl.Timeout = 600000; $reqDl.ReadWriteTimeout = 600000
  $respDl = $reqDl.GetResponse()
  $totalBytes = [int64]$respDl.ContentLength
  if ($totalBytes -gt $TETO) { $respDl.Close(); throw "Pacote maior que o teto ($totalBytes bytes)." }
  $script:totalMb = if ($totalBytes -gt 0) { [math]::Round($totalBytes / 1MB, 1) } else { $null }
  $rs = $respDl.GetResponseStream()
  $fs = [System.IO.File]::Create($zip)
  try {
    $buf = New-Object byte[] 262144
    $lidos = [int64]0; $ultimoTick = 0
    while (($n = $rs.Read($buf, 0, $buf.Length)) -gt 0) {
      $fs.Write($buf, 0, $n)
      $lidos += $n
      if ($lidos -gt $TETO) { throw "Download passou do teto de tamanho - abortado." }
      $agora = [Environment]::TickCount
      if (($agora - $ultimoTick) -ge 250) {
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
  if ($sha -ne ("$($info.sha256)".ToLower())) {
    throw "SHA-256 NAO confere (esperado $($info.sha256), obtido $sha). Pacote corrompido ou adulterado."
  }
  Diga "SHA-256 confere. Montando a versao nova ao lado (a loja segue operando)..."
  Prog "preparando" 10

  # ---- monta a versao nova INTEIRA em $novo ----
  $novo = Join-Path $stage "novo"
  Expand-Archive -Path $zip -DestinationPath $novo -Force
  Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
  $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
  if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
  foreach ($par in @(@('node_modules.tar', 'node_modules'), @('web.tar', 'web'))) {
    $tarArq = Join-Path $novo $par[0]
    if (Test-Path $tarArq) {
      $destino = Join-Path $novo $par[1]
      New-Item -ItemType Directory -Force $destino | Out-Null
      & $tarExe -xf $tarArq -C $destino   # tar respeita caminhos > 260 (Expand-Archive nao)
      if ($LASTEXITCODE -ne 0) { throw "Falha ao extrair $($par[0]) (tar rc=$LASTEXITCODE)." }
      Remove-Item -LiteralPath $tarArq -Force
    }
  }
  if (-not (Test-Path (Join-Path $novo 'node_modules'))) {
    # Pacote antigo (sem node_modules.tar): instala as dependencias NA PASTA NOVA. Se falhar,
    # nada do que esta rodando foi tocado.
    Diga "Pacote sem dependencias embutidas - instalando na pasta nova (precisa de internet)..."
    Push-Location $novo
    try { $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'; npm ci --omit=dev --no-audit --no-fund 2>&1 | Out-Null; $ciRc = $LASTEXITCODE }
    finally { $ErrorActionPreference = $ea; Pop-Location }
    if ($ciRc -ne 0) { throw "Nao consegui instalar as dependencias da versao nova (npm ci rc=$ciRc). Nada foi alterado." }
  }
  foreach ($obrig in @('dist\main.js', 'node_modules\pg\package.json', 'package.json', 'scripts\apply-all-local.mjs', 'edge\saude-local.mjs')) {
    if (-not (Test-Path (Join-Path $novo $obrig))) { throw "Pacote incompleto: falta $obrig. Nada foi alterado." }
  }
  if ((Test-Path (Join-Path $novo 'web')) -and -not (Test-Path (Join-Path $novo 'web\node_modules\next'))) {
    throw "Pacote incompleto: web sem node_modules\next. Nada foi alterado."
  }

  # ---- backup do banco (cifrado, com prazo, nao-fatal) ----
  Prog "backup" 25
  $bakDir = Join-Path $Raiz ("backup-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Force $bakDir | Out-Null
  [System.IO.File]::WriteAllText((Join-Path $bakDir 'versao.txt'), $versaoAtual, $script:Utf8SemBom)
  $pgdump = Get-Command pg_dump -ErrorAction SilentlyContinue
  if ($pgdump -and $cfg.EDGE_DATABASE_URL) {
    Diga "Backup do banco (prazo 120 s)..."
    $dumpTmp = Join-Path $stage 'db.dump'
    $job = Start-Job -ScriptBlock { param($exe, $file, $conn) & $exe --format=custom --file $file $conn } `
      -ArgumentList $pgdump.Source, $dumpTmp, $cfg.EDGE_DATABASE_URL
    if (Wait-Job $job -Timeout 120) {
      Receive-Job $job 2>&1 | Out-Null
      if ($job.State -eq 'Completed' -and (Test-Path $dumpTmp)) {
        Cifrar-Arquivo $dumpTmp (Join-Path $bakDir 'db.dump.enc')
        Diga "Backup do banco OK (cifrado)."
      } else { Diga "AVISO: pg_dump falhou - seguindo sem backup de banco (o codigo volta pelo backup-*)." }
    } else {
      Diga "AVISO: pg_dump passou de 120 s - cancelado; seguindo sem backup de banco."
      Stop-Job $job -ErrorAction SilentlyContinue
      Get-Process pg_dump -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Remove-Job $job -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $dumpTmp -Force -ErrorAction SilentlyContinue
  } else {
    Diga "AVISO: pg_dump nao encontrado - seguindo sem backup de banco."
  }
  # scripts do edge atuais (voltam se a troca falhar ou no reverter)
  $edgeAtual = Join-Path $Raiz 'edge'
  New-Item -ItemType Directory -Force (Join-Path $bakDir 'edge') | Out-Null
  Get-ChildItem -LiteralPath $edgeAtual -File | ForEach-Object { Copy-Item $_.FullName (Join-Path $bakDir ('edge\' + $_.Name)) -Force }
}
catch {
  # Falha na PREPARACAO: nada do que esta rodando foi tocado. So reporta.
  $errIni = $_.Exception.Message
  Diga "ERRO (preparacao): $errIni"
  $script:acaoFinal = "A atualizacao nao foi aplicada (falhou na preparacao) e nada foi alterado. Tente de novo; se persistir, fale com o suporte."
  Prog "erro" 100 'erro' $errIni
  if ($cloud) { Enviar-Telemetria $cloud 'update_falha' $errIni @{ versaoNova = $script:versaoNova; versaoAtual = $versaoAtual; tenantId = $cfg.EDGE_TENANT_ID } }
  if ($stage) { Apagar-Pasta $stage }
  if ($bakDir) { Apagar-Pasta $bakDir }
  $trava.Close()
  throw
}

# ================= TROCA (servicos parados por 1-2 min) =================
try {
  Diga "Parando servicos..."; Prog "trocando" 45
  Parar-Servicos
  $trocou = $true

  Diga "Trocando o conjunto da versao (renomear pastas)..."
  foreach ($it in $script:ItensDaVersao) {
    $de = Join-Path $novo $it
    if (-not (Test-Path -LiteralPath $de)) { continue }   # pacote sem o item: mantem o atual
    $atual = Join-Path $Raiz $it
    if (Test-Path -LiteralPath $atual) {
      Mover $atual (Join-Path $bakDir $it)
      $diario.Add(@{ item = $it; acao = 'guardado' })
    }
    Mover $de $atual
    $diario.Add(@{ item = $it; acao = 'instalado' })
  }

  # Scripts do edge: sobrepoe arquivo a arquivo (este script roda de dentro da pasta) e tira as
  # ferramentas da distribuicao que versoes antigas deixaram aqui (ERR-053).
  Get-ChildItem -LiteralPath (Join-Path $novo 'edge') -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $edgeAtual $_.Name) -Force
  }
  foreach ($f in $script:FerramentasDistribuicao) {
    Remove-Item -LiteralPath (Join-Path $edgeAtual $f) -Force -ErrorAction SilentlyContinue
  }
  $diario.Add(@{ item = 'edge'; acao = 'sobreposto' })

  Grava-AppVersion $envFile $script:versaoNova
  $diario.Add(@{ item = 'APP_VERSION'; acao = 'gravado' })
  Diga "APP_VERSION = $($script:versaoNova)."

  Diga "Aplicando migrations..."; Prog "migrando" 65
  # Conexao DECIFRADA por variavel de ambiente: o .env.local da loja e cifrado (DPAPI) e o
  # apply-all-local lia 'enc:...' como conexao -> toda atualizacao falhava aqui (ERR-056).
  $env:DATABASE_URL = $cfg.EDGE_DATABASE_URL
  $env:EDGE_MODE = 'true'
  $mg = Rodar-Node @((Join-Path $Raiz 'scripts\apply-all-local.mjs')) 20 $Raiz 'migrations'
  Remove-Item Env:\DATABASE_URL -ErrorAction SilentlyContinue
  if ($mg -ne 0) { throw "migrations falharam (rc=$mg) - veja logs\migrations.err.log." }

  # Servicos/tarefas que um edge antigo pode nao ter (idempotente).
  $status = (& $script:nssmExe status RegemEdgeImpressao 2>$null)
  if (-not $status) {
    Diga "Registrando servico faltante: RegemEdgeImpressao"
    & $script:nssmExe install RegemEdgeImpressao $script:nodeExe | Out-Null
    & $script:nssmExe set RegemEdgeImpressao AppParameters (Join-Path $Raiz 'edge\impressao-daemon.mjs') | Out-Null
    & $script:nssmExe set RegemEdgeImpressao AppDirectory $Raiz | Out-Null
    & $script:nssmExe set RegemEdgeImpressao Start SERVICE_AUTO_START | Out-Null
    & $script:nssmExe set RegemEdgeImpressao AppStdout (Join-Path $Raiz 'logs\RegemEdgeImpressao.log') | Out-Null
    & $script:nssmExe set RegemEdgeImpressao AppStderr (Join-Path $Raiz 'logs\RegemEdgeImpressao.err.log') | Out-Null
  }
  foreach ($t in @(@('RegemEdgeUpdate', 'atualizar.ps1'), @('RegemEdgeRollback', 'reverter.ps1'))) {
    try {
      $scr = Join-Path $Raiz ('edge\' + $t[1])
      $acao = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument ("-ExecutionPolicy Bypass -NoProfile -File `"{0}`" -Raiz `"{1}`"" -f $scr, $Raiz)
      $conta = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
      $cfgT = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd -ExecutionTimeLimit (New-TimeSpan -Minutes 45)
      Register-ScheduledTask -TaskName $t[0] -Action $acao -Principal $conta -Settings $cfgT -Force | Out-Null
    } catch { Diga "(aviso) nao registrei a tarefa $($t[0]): $($_.Exception.Message)" }
  }
  # AFINACAO do Postgres: idempotente (o script marca o bloco no postgresql.conf) e so
  # com ajustes que recarregam sem reiniciar. Aqui a loja que ja esta instalada tambem
  # recebe - antes nenhuma recebia, porque ninguem chamava o script.
  try {
    $afinarPg = Join-Path $Raiz 'edge\afinar-postgres.ps1'
    $pgDataL = Join-Path (Split-Path $Raiz -Parent) 'pgdata'
    $pgBinL = Join-Path (Split-Path $Raiz -Parent) 'pgsql\bin'
    if ((Test-Path $afinarPg) -and (Test-Path $pgDataL) -and (Test-Path $pgBinL)) {
      & powershell -ExecutionPolicy Bypass -NoProfile -File $afinarPg -PgData $pgDataL -PgBin $pgBinL | Out-Null
    }
  } catch { Diga "(aviso) nao consegui afinar o Postgres: $($_.Exception.Message)" }

  # BACKUP DIARIO: ate aqui so o instalador (.exe) criava esta tarefa. Loja atualizada
  # apenas por .zip recebia o backup.ps1 e NUNCA ganhava a tarefa - ficava sem backup e
  # sem aviso. Agora toda atualizacao garante a tarefa (idempotente, -Force).
  try {
    $scrBk = Join-Path $Raiz 'edge\backup.ps1'
    if (Test-Path $scrBk) {
      $acaoBk = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -Raiz `"{1}`"" -f $scrBk, $Raiz)
      $contaBk = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
      $cfgBk = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
        -ExecutionTimeLimit (New-TimeSpan -Minutes 60) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
      Register-ScheduledTask -TaskName 'RegemEdgeBackup' -Action $acaoBk -Trigger (New-ScheduledTaskTrigger -Daily -At 3am) `
        -Principal $contaBk -Settings $cfgBk -Force | Out-Null
    }
  } catch { Diga "(aviso) nao registrei a tarefa RegemEdgeBackup: $($_.Exception.Message)" }

  Diga "Subindo servicos..."; Prog "subindo" 80
  Subir-Servicos
  Diga "Conferindo a saude (versao nova no ar + servicos de pe)..."; Prog "verificando" 90
  $motivo = Checar-Saude $porta $script:versaoNova 150
  if ($motivo) { throw "Saude reprovada: $motivo." }

  # Sucesso.
  Remove-Item -LiteralPath (Join-Path $script:logDir 'update-revertida.txt') -Force -ErrorAction SilentlyContinue
  $script:acaoFinal = "Pronto! Nenhuma acao necessaria - os servicos ja reiniciaram. Recarregue a pagina se ela nao atualizar sozinha."
  Prog "ok" 100 'ok'
  Diga "OK! Atualizado para $($script:versaoNova). Versao anterior guardada em $bakDir."
  Apagar-Pasta $stage
  Podar $Raiz 'backup-*' 2
  Podar $Raiz 'falhou-*' 1
}
catch {
  $errMsg = $_.Exception.Message
  Diga "ERRO na troca: $errMsg"
  Prog "revertendo" 95 'instalando' $errMsg
  if ($trocou) {
    Diga "Voltando a versao anterior (conjunto inteiro)..."
    Parar-Servicos
    for ($i = $diario.Count - 1; $i -ge 0; $i--) {
      $d = $diario[$i]
      try {
        switch ($d.acao) {
          'instalado' { Mover (Join-Path $Raiz $d.item) (Join-Path $stage ('falhou-' + $d.item)) }
          'guardado'  { Mover (Join-Path $bakDir $d.item) (Join-Path $Raiz $d.item) }
          'sobreposto' {
            Get-ChildItem -LiteralPath (Join-Path $bakDir 'edge') -File | ForEach-Object {
              Copy-Item $_.FullName (Join-Path $edgeAtual $_.Name) -Force
            }
          }
          'gravado' { Grava-AppVersion $envFile $versaoAtual }
        }
      } catch { Diga "  (aviso) nao desfiz $($d.item): $($_.Exception.Message)" }
    }
    Subir-Servicos
    $motivoVolta = Checar-Saude $porta $versaoAtual 150
    if ($motivoVolta) {
      Diga "ATENCAO: a versao anterior voltou, mas a saude reprovou: $motivoVolta"
      $script:acaoFinal = "A atualizacao falhou e a versao anterior foi restaurada, mas o servidor nao respondeu como esperado. Reinicie o computador; se persistir, fale com o suporte."
    } else {
      Diga "Versao anterior ($versaoAtual) de volta e saudavel."
      $script:acaoFinal = "A atualizacao falhou e foi desfeita automaticamente: o servidor voltou para a versao $versaoAtual e esta funcionando. Nada a fazer."
    }
    # O backup desta tentativa esta incompleto (as pastas voltaram para o lugar): nao pode ser
    # escolhido pelo reverter.ps1.
    try { Mover $bakDir (Join-Path $Raiz ("falhou-{0}" -f (Split-Path $bakDir -Leaf).Substring(7))) } catch {}
  } else {
    $script:acaoFinal = "A atualizacao nao foi aplicada e nada foi alterado. Tente de novo; se persistir, fale com o suporte."
  }
  Prog "erro" 100 'erro' $errMsg
  Enviar-Telemetria $cloud 'update_falha' $errMsg @{ versaoNova = $script:versaoNova; versaoAtual = $versaoAtual; tenantId = $cfg.EDGE_TENANT_ID }
  if ($stage) { Apagar-Pasta $stage }
  throw
}
finally {
  if ($trava) { $trava.Close() }
}
