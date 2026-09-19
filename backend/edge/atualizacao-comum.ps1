# Regem Edge - funcoes COMUNS da atualizacao (atualizar.ps1) e do rollback (reverter.ps1).
# Uso (no topo do script):   . (Join-Path $PSScriptRoot 'atualizacao-comum.ps1')
# Antes de usar, o script define: $script:Raiz, $script:log, $script:statusFile.
#
# ASCII puro de proposito: o PowerShell 5.1 le .ps1 sem BOM como ANSI.
#
# Modelo (o mesmo do Velopack/Squirrel e das atualizacoes A/B do Android): a versao nova e
# MONTADA INTEIRA numa pasta ao lado, sem tocar na que esta rodando; a troca e so RENOMEAR
# pastas no mesmo disco (rapido e reversivel); voltar e renomear de novo. Nada de copiar
# arquivo a arquivo nem baixar dependencia no meio da troca (ERR-045, ERR-047).

# Tudo o que muda de uma versao para outra - trocado e voltado JUNTO.
$script:ItensDaVersao = @('dist', 'node_modules', 'web', 'scripts', 'database',
  'package.json', 'package-lock.json', 'dist-manifest.json', 'version.txt')
$script:Servicos = @('RegemEdgeApi', 'RegemEdgeSync', 'RegemEdgeImpressao', 'RegemEdgeWeb')
# Ferramentas da DISTRIBUICAO que versoes antigas deixaram no PC da loja (ERR-053).
$script:FerramentasDistribuicao = @('publicar.ps1', 'sign-update.mjs', 'gerar-ca-assinatura.mjs',
  'build-release.ps1', 'package.mjs', 'preflight-release.mjs', 'build-web.mjs', 'regem-edge.iss',
  'update-priv.pem', 'COMPILAR-INSTALADOR.md', 'PASSO-A-PASSO.md', 'ATUALIZAR.md', 'README.md')

$script:Utf8SemBom = New-Object System.Text.UTF8Encoding($false)

function Diga($m) {
  $l = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m
  Write-Host $l
  try { Add-Content -Path $script:log -Value $l } catch {}
}

# Status para a tela Servidor. SEM BOM: com BOM o JSON.parse da API falhava e a barra de
# progresso nunca aparecia (ERR-055).
function Grava-Status($obj) {
  try {
    $obj['ts'] = (Get-Date -Format o)
    [System.IO.File]::WriteAllText($script:statusFile, ($obj | ConvertTo-Json -Compress), $script:Utf8SemBom)
  } catch {}
}

function Ler-Env($envFile) {
  $cfg = @{}
  foreach ($linha in [System.IO.File]::ReadAllLines($envFile)) {
    if ($linha -match '^\s*#') { continue }
    if ($linha -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() }
  }
  foreach ($k in @('EDGE_DATABASE_URL', 'DATABASE_URL', 'SYNC_TOKEN', 'JWT_SECRET')) {
    if ($cfg.ContainsKey($k)) { $cfg[$k] = DecDpapi $cfg[$k] }
  }
  return $cfg
}

function DecDpapi($v) {
  if (-not $v -or -not $v.StartsWith('enc:')) { return $v }
  try {
    Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
    $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
      [Convert]::FromBase64String($v.Substring(4)), $null,
      [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
    return [System.Text.Encoding]::UTF8.GetString($dec)
  } catch { Diga "(aviso) nao decifrei um segredo DPAPI: $($_.Exception.Message)"; return $v }
}

# APP_VERSION acompanha o CODIGO que esta no ar (ERR-047: o rollback deixava a versao nova).
function Grava-AppVersion($envFile, $versao) {
  $linhas = [System.Collections.Generic.List[string]]([System.IO.File]::ReadAllLines($envFile))
  $achou = $false
  for ($i = 0; $i -lt $linhas.Count; $i++) {
    if ($linhas[$i] -match '^\s*APP_VERSION\s*=') { $linhas[$i] = "APP_VERSION=$versao"; $achou = $true }
  }
  if (-not $achou) { $linhas.Add("APP_VERSION=$versao") }
  [System.IO.File]::WriteAllLines($envFile, $linhas, $script:Utf8SemBom)
}

# Trava entre atualizar.ps1 e reverter.ps1: arquivo aberto com acesso EXCLUSIVO enquanto o
# script roda. O Windows solta sozinho se o processo morrer - nunca fica presa.
function Obter-Trava($caminho) {
  try { return [System.IO.File]::Open($caminho, 'OpenOrCreate', 'ReadWrite', 'None') } catch { return $null }
}

function Svc($acao, $nome) {
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $script:nssmExe $acao $nome 2>&1 | Out-Null } catch {}
  $ErrorActionPreference = $ea
}

# Para os DEPENDENTES primeiro e o Api por ultimo, e ESPERA pararem de verdade (uma pasta com
# arquivo aberto nao pode ser renomeada).
function Parar-Servicos {
  foreach ($s in @('RegemEdgeWeb', 'RegemEdgeImpressao', 'RegemEdgeSync', 'RegemEdgeApi')) { Svc stop $s }
  foreach ($s in $script:Servicos) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc) {
      try { $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(45)) }
      catch { Diga "(aviso) $s nao parou em 45s (estado: $($svc.Status))." }
    }
  }
  Start-Sleep -Seconds 2
}

function Subir-Servicos {
  foreach ($s in @('RegemEdgeApi', 'RegemEdgeSync', 'RegemEdgeImpressao', 'RegemEdgeWeb')) { Svc start $s }
}

# Renomeia (mesmo disco = instantaneo). Tenta 5x: antivirus/indexador seguram arquivo por
# alguns segundos. Destino NAO pode existir.
function Mover($de, $para) {
  for ($i = 1; $i -le 5; $i++) {
    try {
      if (Test-Path -LiteralPath $de -PathType Container) { [System.IO.Directory]::Move($de, $para) }
      else { [System.IO.File]::Move($de, $para) }
      return
    } catch {
      if ($i -eq 5) { throw "nao consegui mover '$de' para '$para': $($_.Exception.Message)" }
      Start-Sleep -Seconds 2
    }
  }
}

# Apaga pasta com caminhos longos (node_modules do next passa de 260) - o Remove-Item do
# PS 5.1 falha nesses; o rd com prefixo \\?\ nao.
function Apagar-Pasta($p) {
  if (-not (Test-Path -LiteralPath $p)) { return }
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & cmd.exe /c "rd /s /q `"\\?\$p`"" 2>&1 | Out-Null } catch {}
  $ErrorActionPreference = $ea
  if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue }
}

# Mantem as N pastas mais novas que casam com o filtro (backup-*, revertido-*, falhou-*).
function Podar($raiz, $filtro, $manter) {
  Get-ChildItem -LiteralPath $raiz -Directory -Filter $filtro -ErrorAction SilentlyContinue |
    Sort-Object Name -Descending | Select-Object -Skip $manter |
    ForEach-Object { Diga "Limpando $($_.Name)"; Apagar-Pasta $_.FullName }
}

# Roda o node com prazo (uma etapa travada nao prende a atualizacao para sempre).
function Rodar-Node($argumentos, $minutos, $cwd, $nome) {
  $out = Join-Path $script:logDir ("$nome.out.log")
  $err = Join-Path $script:logDir ("$nome.err.log")
  # Start-Process junta os argumentos com espaco SEM aspas: caminho com espaco quebraria.
  $argumentos = @($argumentos | ForEach-Object { if ("$_" -match '\s') { '"' + $_ + '"' } else { "$_" } })
  $p = Start-Process -FilePath $script:nodeExe -ArgumentList $argumentos -WorkingDirectory $cwd `
    -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
  $null = $p.Handle   # PS 5.1: sem ler o Handle logo, o ExitCode volta vazio
  if (-not $p.WaitForExit($minutos * 60000)) {
    try { $p.Kill() } catch {}
    throw "$nome passou de $minutos min - interrompido (veja $err)."
  }
  return $p.ExitCode
}

# Cifra/decifra o dump do banco com DPAPI (so abre NESTA maquina) - igual ao backup diario.
# Antes o dump da atualizacao ficava em texto puro (ERR-050).
function Cifrar-Arquivo($de, $para) {
  Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
  $enc = [System.Security.Cryptography.ProtectedData]::Protect([System.IO.File]::ReadAllBytes($de), $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  [System.IO.File]::WriteAllBytes($para, $enc)
}
function Decifrar-Arquivo($de, $para) {
  Add-Type -AssemblyName System.Security -ErrorAction SilentlyContinue
  $dec = [System.Security.Cryptography.ProtectedData]::Unprotect([System.IO.File]::ReadAllBytes($de), $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  [System.IO.File]::WriteAllBytes($para, $dec)
}

# Saude DEPOIS de subir (ERR-048): o /ping responde na versao ESPERADA e os 4 servicos estao
# rodando - e continuam assim 30 s depois (um servico que cai em loop fica "Paused" no NSSM).
# Devolve $null se ok, ou o motivo.
function Checar-Saude($porta, $versao, $segundos = 120) {
  # Stop + stderr de nativo = erro fatal no PS 5.1 (licao do #457): aqui o codigo le o rc.
  $ErrorActionPreference = 'Continue'
  $saude = Join-Path $script:Raiz 'edge\saude-local.mjs'
  $fim = (Get-Date).AddSeconds($segundos)
  $ultimo = ''
  do {
    Start-Sleep -Seconds 3
    $ultimo = (& $script:nodeExe $saude $porta $versao 2>$null | Select-Object -Last 1)
    $rc = $LASTEXITCODE
  } while ($rc -ne 0 -and (Get-Date) -lt $fim)
  if ($rc -eq 1) { return "a API respondeu na versao '$ultimo', esperada '$versao'" }
  if ($rc -ne 0) { return "a API nao respondeu em $segundos s" }
  Start-Sleep -Seconds 30
  foreach ($s in $script:Servicos) {
    $svc = Get-Service -Name $s -ErrorAction SilentlyContinue
    if ($svc -and $svc.Status -ne 'Running') { return "o servico $s esta '$($svc.Status)'" }
  }
  $null = (& $script:nodeExe $saude $porta $versao 2>$null)
  if ($LASTEXITCODE -ne 0) { return "a API parou de responder na versao $versao depois de subir" }
  return $null
}

# Telemetria pela rota PUBLICA (funciona mesmo sem token valido). Best-effort. Leva o fim do
# log - que nunca contem segredo (nenhum Diga imprime conexao/token).
function Enviar-Telemetria($cloud, $tipo, $msg, $extra) {
  try {
    $logTail = ""
    if (Test-Path $script:log) { $logTail = (Get-Content $script:log -Tail 40 -ErrorAction SilentlyContinue) -join "`n" }
    $corpo = @{ tipo = $tipo; erro = $msg; logTail = $logTail; modo = 'auto-update' }
    if ($extra) { foreach ($k in $extra.Keys) { $corpo[$k] = $extra[$k] } }
    Invoke-RestMethod -Method Post -Uri ("{0}/edge/telemetria/erro" -f $cloud) `
      -Body ($corpo | ConvertTo-Json -Compress) -ContentType "application/json" -TimeoutSec 15 | Out-Null
  } catch { Diga "(aviso) nao consegui enviar a telemetria: $($_.Exception.Message)" }
}
