# Regem Edge - REVERTER (rollback manual) para a versao anterior a ultima atualizacao.
#
# Devolve o CONJUNTO INTEIRO guardado pelo atualizar.ps1 em backup-<data>\ (dist, dependencias,
# app, scripts, migrations, manifesto, scripts do edge) e o APP_VERSION - antes voltavam so o
# dist e o app, e o servidor seguia se dizendo na versao nova (ERR-047).
# NAO restaura o banco por padrao (perderia o que foi operado depois); -ComBanco so se o
# problema for de dados. As migrations sao aditivas: o codigo anterior roda no banco novo.
#
# Disparado pelo botao "Reverter atualizacao" do app (schtasks /run /tn RegemEdgeRollback) ou
# pelo comando remoto da distribuicao. Recomendado com a loja FECHADA.
param(
  [string]$Raiz = "C:\regem-edge\backend",
  [switch]$ComBanco
)

$ErrorActionPreference = "Stop"
$script:Raiz = $Raiz
$script:logDir = Join-Path $Raiz "logs"
New-Item -ItemType Directory -Force $script:logDir | Out-Null
$script:log = Join-Path $script:logDir ("reverter-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
$script:statusFile = Join-Path $script:logDir "update-status.json"
. (Join-Path $PSScriptRoot 'atualizacao-comum.ps1')

function Prog($estagio, $pct, $fase = 'instalando', $erro = $null, $acao = $null) {
  Grava-Status @{ fase = $fase; estagio = $estagio; pct = $pct; versao = $script:alvo; erro = $erro; acaoFinal = $acao }
}

$trava = Obter-Trava (Join-Path $script:logDir 'atualizacao.lock')
if (-not $trava) { Diga "Uma atualizacao ou reversao ja esta rodando - saindo sem mexer em nada."; exit 1 }

$edgeBase = Split-Path $Raiz -Parent
if (Test-Path (Join-Path $edgeBase 'node\node.exe')) { $env:Path = (Join-Path $edgeBase 'node') + ';' + $env:Path }
if (Test-Path (Join-Path $edgeBase 'pgsql\bin'))     { $env:Path = (Join-Path $edgeBase 'pgsql\bin') + ';' + $env:Path }
$script:nssmExe = if (Test-Path (Join-Path $edgeBase 'nssm\nssm.exe')) { Join-Path $edgeBase 'nssm\nssm.exe' } else { 'nssm' }
$script:nodeExe = if (Test-Path (Join-Path $edgeBase 'node\node.exe')) { Join-Path $edgeBase 'node\node.exe' } else { 'node' }

$envFile = Join-Path $Raiz ".env.local"
$diario = New-Object System.Collections.Generic.List[object]
$desfeito = $null
$script:alvo = $null

try {
  if (-not (Test-Path $envFile)) { throw ".env.local nao encontrado em $Raiz" }
  $cfg = Ler-Env $envFile
  $versaoAtual = if ($cfg.APP_VERSION) { $cfg.APP_VERSION } else { "0" }
  $cloud = "$($cfg.CLOUD_API)".TrimEnd("/")
  $porta = if ($cfg.PORT) { $cfg.PORT } else { "3001" }

  # Backup mais recente que tem codigo para voltar (os "falhou-*" da atualizacao ficam de fora).
  $bak = Get-ChildItem -LiteralPath $Raiz -Directory -Filter 'backup-*' -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'dist') } |
    Sort-Object Name -Descending | Select-Object -First 1
  if (-not $bak) { throw "Nenhum backup com versao anterior em $Raiz. Nada para reverter." }
  $vArq = Join-Path $bak.FullName 'versao.txt'
  $script:alvo = if (Test-Path $vArq) { ([System.IO.File]::ReadAllText($vArq)).Trim() } else { $null }
  if (-not $script:alvo) {
    # Backup no formato ANTIGO (feito pelo atualizar.ps1 ate a 1.29.x) nao tem versao.txt: a
    # versao esta no log daquela atualizacao ("Versao instalada: X" + o nome desta pasta).
    foreach ($lg in (Get-ChildItem -LiteralPath $script:logDir -Filter 'atualizar-*.log' -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
      $txt = [System.IO.File]::ReadAllText($lg.FullName)
      if ($txt.Contains($bak.Name) -and $txt -match 'Versao instalada: (\d+\.\d+\.\d+)') { $script:alvo = $Matches[1]; break }
    }
  }
  Diga ("Revertendo {0} -> {1} a partir de {2}" -f $versaoAtual, $(if ($script:alvo) { $script:alvo } else { '(versao nao registrada)' }), $bak.Name)
  Prog "revertendo" 20

  Parar-Servicos
  $desfeito = Join-Path $Raiz ("revertido-{0}" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
  New-Item -ItemType Directory -Force $desfeito | Out-Null

  foreach ($it in $script:ItensDaVersao) {
    $guardado = Join-Path $bak.FullName $it
    if (-not (Test-Path -LiteralPath $guardado)) { continue }
    $atual = Join-Path $Raiz $it
    if (Test-Path -LiteralPath $atual) {
      Mover $atual (Join-Path $desfeito $it)
      $diario.Add(@{ item = $it; acao = 'afastado' })
    }
    Mover $guardado $atual
    $diario.Add(@{ item = $it; acao = 'restaurado' })
  }

  # Backup no formato antigo (so dist + web.tar): o app volta do tar.
  $webTar = Join-Path $bak.FullName 'web.tar'
  if ((Test-Path $webTar) -and -not (Test-Path -LiteralPath (Join-Path $bak.FullName 'web'))) {
    $webAtual = Join-Path $Raiz 'web'
    if (Test-Path -LiteralPath $webAtual) { Mover $webAtual (Join-Path $desfeito 'web'); $diario.Add(@{ item = 'web'; acao = 'afastado' }) }
    New-Item -ItemType Directory -Force $webAtual | Out-Null
    $tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'; if (-not (Test-Path $tarExe)) { $tarExe = 'tar' }
    & $tarExe -xf $webTar -C $webAtual
    if ($LASTEXITCODE -ne 0) { throw "falha ao extrair o web.tar do backup (rc=$LASTEXITCODE)." }
  }

  # Scripts do edge da versao anterior (sobrepoe; os que so existem na nova ficam, inofensivos).
  $edgeBak = Join-Path $bak.FullName 'edge'
  if (Test-Path -LiteralPath $edgeBak) {
    Get-ChildItem -LiteralPath $edgeBak -File | ForEach-Object {
      # este proprio script e as funcoes comuns ficam na versao atual (estao em uso)
      if ($_.Name -notin @('reverter.ps1', 'atualizacao-comum.ps1', 'saude-local.mjs')) {
        Copy-Item $_.FullName (Join-Path $Raiz ('edge\' + $_.Name)) -Force
      }
    }
  }

  if ($script:alvo) { Grava-AppVersion $envFile $script:alvo; Diga "APP_VERSION = $($script:alvo)." }
  # A tela avisa se o gestor tentar instalar de novo a versao que ele acabou de reverter.
  [System.IO.File]::WriteAllText((Join-Path $script:logDir 'update-revertida.txt'), $versaoAtual, $script:Utf8SemBom)

  if ($ComBanco) {
    $pgrestore = Get-Command pg_restore -ErrorAction SilentlyContinue
    $dumpEnc = Join-Path $bak.FullName 'db.dump.enc'
    $dumpTxt = Join-Path $bak.FullName 'db.dump'   # backups antigos (sem cifra)
    if ($pgrestore -and $cfg.EDGE_DATABASE_URL -and ((Test-Path $dumpEnc) -or (Test-Path $dumpTxt))) {
      $dump = $dumpTxt
      if (Test-Path $dumpEnc) { $dump = Join-Path $env:TEMP ("regem-restore-{0}.dump" -f (Get-Random)); Decifrar-Arquivo $dumpEnc $dump }
      Diga "Restaurando o banco do backup (--clean)..."
      $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
      & $pgrestore.Source --clean --if-exists --no-owner --dbname $cfg.EDGE_DATABASE_URL $dump 2>&1 | Out-Null
      $rcR = $LASTEXITCODE; $ErrorActionPreference = $ea
      if ($dump -ne $dumpTxt) { Remove-Item -LiteralPath $dump -Force -ErrorAction SilentlyContinue }
      Diga "pg_restore terminou (rc=$rcR)."
    } else { Diga "(aviso) -ComBanco pedido, mas nao ha dump/pg_restore. Banco mantido." }
  } else {
    Diga "Banco mantido (rollback so do codigo). Para voltar o banco: reverter.ps1 -ComBanco"
  }

  Subir-Servicos
  Prog "verificando" 90
  $motivo = if ($script:alvo) { Checar-Saude $porta $script:alvo 150 } else { Checar-Saude $porta '' 150 }
  # O backup foi consumido: o que sobrou dele (dump, scripts) vai junto com a versao afastada.
  Get-ChildItem -LiteralPath $bak.FullName -Force | ForEach-Object { try { Mover $_.FullName (Join-Path $desfeito ('backup-' + $_.Name)) } catch {} }
  Apagar-Pasta $bak.FullName
  Podar $Raiz 'revertido-*' 1
  if ($motivo) {
    Diga "(aviso) versao anterior de volta, mas a saude reprovou: $motivo"
    Prog "erro" 100 'erro' $motivo "A versao anterior foi restaurada, mas o servidor nao respondeu como esperado. Reinicie o computador; se persistir, fale com o suporte."
  } else {
    Diga "OK! Versao anterior restaurada e servicos no ar."
    Prog "ok" 100 'ok' $null "Versao anterior restaurada. Recarregue a pagina."
  }
  # A distribuicao precisa saber (pausar o release se varias lojas reverterem).
  if ($cloud) { Enviar-Telemetria $cloud 'update_revertido' "Revertido de $versaoAtual para $($script:alvo)" @{ versaoNova = $versaoAtual; versaoAtual = $script:alvo; tenantId = $cfg.EDGE_TENANT_ID } }
}
catch {
  $erro = $_.Exception.Message
  Diga "ERRO no rollback: $erro"
  if ($diario.Count) {
    Diga "Desfazendo o que o rollback ja tinha trocado..."
    Parar-Servicos
    for ($i = $diario.Count - 1; $i -ge 0; $i--) {
      $d = $diario[$i]
      try {
        if ($d.acao -eq 'restaurado') { Mover (Join-Path $Raiz $d.item) (Join-Path $bak.FullName $d.item) }
        elseif ($d.acao -eq 'afastado') { Mover (Join-Path $desfeito $d.item) (Join-Path $Raiz $d.item) }
      } catch { Diga "  (aviso) nao desfiz $($d.item): $($_.Exception.Message)" }
    }
  }
  Subir-Servicos
  Prog "erro" 100 'erro' $erro "O rollback nao foi concluido e o servidor seguiu na versao atual. Fale com o suporte."
  throw
}
finally {
  if ($trava) { $trava.Close() }
}
