# Regem Edge - BACKUP agendado do banco local, cifrado em repouso (DPAPI LocalMachine).
# Rodado pela tarefa diaria RegemEdgeBackup (registrada pelo instalador, pela atualizacao
# e pelo corrigir-tasks.ps1).
#   pg_dump --format=custom  ->  cifra com DPAPI (so decifra NESTA maquina)  ->  backups\
# Retencao configuravel (padrao 14 dias).
#
# OBS de DR: este backup e para recuperacao LOCAL (corrupcao/rollback na mesma maquina).
# Para "servidor queimou" (maquina nova), a restauracao vem da NUVEM (sync/restore), pois
# o blob DPAPI nao decifra em outra maquina - ver docs/roadmap-seguranca-migracao.md ?5.
#
# SEMPRE deixa rastro (ERR-063/064/065): grava logs\backup.log e o resultado em
# backups\ultimo-backup.json. O daemon de sync le esse arquivo e manda a idade/resultado
# no sinal de saude - e por isso que a nuvem passa a saber que a loja parou de fazer backup.
param([string]$Raiz = "C:\regem-edge\backend", [int]$Reter = 14, [int]$MinimoLivreMb = 1024)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

$base   = Split-Path $Raiz -Parent
$bakDir = Join-Path $base "backups"
$logDir = Join-Path $Raiz "logs"
New-Item -ItemType Directory -Force $bakDir | Out-Null
New-Item -ItemType Directory -Force $logDir | Out-Null
$logFile = Join-Path $logDir 'backup.log'
$marcador = Join-Path $bakDir 'ultimo-backup.json'
$inicio = Get-Date
$stamp = $inicio.ToString("yyyyMMdd-HHmmss")
$tmp = Join-Path $env:TEMP ("regem-bak-{0}.dump" -f $stamp)

function Reg($msg) {
  $linha = "[{0}] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg
  Write-Host $linha
  # .NET direto (e nao Add-Content): o caminho do TEMP do SYSTEM ou de um usuario com nome
  # curto (8.3, com ~) faz o provider do PowerShell recusar o caminho - e o log e
  # justamente o que nao pode falhar aqui.
  try { [IO.File]::AppendAllText($logFile, $linha + [Environment]::NewLine, [Text.Encoding]::UTF8) } catch {}
}

function Apagar-Temp() {
  try { if ([IO.File]::Exists($tmp)) { [IO.File]::Delete($tmp) } } catch {}
}

# Resultado em arquivo: e o UNICO jeito de alguem (nos, a nuvem, o lojista) saber que o
# backup rodou. Escrito tanto no sucesso quanto na falha.
function Gravar-Resultado($ok, $erro, $arquivo, $bytes) {
  try {
    $o = [ordered]@{
      ok        = [bool]$ok
      em        = (Get-Date).ToString('o')
      duracao_s = [int]((Get-Date) - $inicio).TotalSeconds
      arquivo   = $arquivo
      bytes     = $bytes
      erro      = $erro
    }
    [IO.File]::WriteAllText($marcador, ($o | ConvertTo-Json -Compress), [Text.Encoding]::UTF8)
  } catch { Reg "(aviso) nao consegui gravar $marcador : $($_.Exception.Message)" }
}

function DecDpapi($v) {
  if ($v -notlike 'enc:*') { return $v }
  $b = [Convert]::FromBase64String($v.Substring(4))
  $p = [Security.Cryptography.ProtectedData]::Unprotect($b, $null, 'LocalMachine')
  return [Text.Encoding]::UTF8.GetString($p)
}

try {
  $envF = Join-Path $Raiz ".env.local"
  if (-not (Test-Path $envF)) { throw ".env.local nao encontrado: $envF" }
  $cfg = @{}
  foreach ($l in Get-Content $envF) { if ($l -match '^\s*([A-Z0-9_]+)\s*=\s*(.*)$') { $cfg[$Matches[1]] = $Matches[2].Trim() } }
  $dburl = DecDpapi $cfg.EDGE_DATABASE_URL
  if (-not $dburl) { throw "EDGE_DATABASE_URL ausente no .env.local." }

  # DISCO: sem esta checagem, o pg_dump enchia o disco, falhava no meio e deixava um dump
  # EM TEXTO PURO no %TEMP% (o Remove-Item nunca rodava) - mais disco ocupado e PII solta.
  $unidade = (Split-Path $env:TEMP -Qualifier)
  $livreMb = [int]((Get-PSDrive -Name $unidade.TrimEnd(':')).Free / 1MB)
  if ($livreMb -lt $MinimoLivreMb) {
    throw ("espaco livre insuficiente em {0} ({1} MB livres, minimo {2} MB) - backup NAO feito" -f $unidade, $livreMb, $MinimoLivreMb)
  }

  $pgdump = (Get-Command pg_dump -ErrorAction SilentlyContinue)
  if (-not $pgdump) {
    $embed = Join-Path $base 'pgsql\bin\pg_dump.exe'
    if (Test-Path $embed) { $pgdump = [pscustomobject]@{ Source = $embed } } else { throw "pg_dump nao encontrado (nem no PATH nem embutido)." }
  }
  Reg "iniciando pg_dump (livre em ${unidade} ${livreMb} MB)"
  & $pgdump.Source --format=custom --file $tmp $dburl
  if ($LASTEXITCODE -ne 0) { throw "pg_dump falhou (rc=$LASTEXITCODE)." }

  $tamanho = (New-Object IO.FileInfo($tmp)).Length
  # LIMITE REAL do metodo: ReadAllBytes + Protect carregam o dump inteiro na memoria e o
  # .NET Framework do PS 5.1 nao le array acima de ~2 GB. Falhar com mensagem clara e
  # melhor do que estourar com "Array dimensions exceeded supported range" no log.
  if ($tamanho -gt 1900MB) {
    throw ("dump de {0} MB passou do limite do metodo de cifragem (~1900 MB). O banco precisa de expurgo ou de backup por partes." -f [int]($tamanho / 1MB))
  }

  $bytes = [IO.File]::ReadAllBytes($tmp)
  $enc = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'LocalMachine')
  $destino = Join-Path $bakDir ("db-{0}.dump.enc" -f $stamp)
  [IO.File]::WriteAllBytes($destino, $enc)
  Apagar-Temp

  # Retencao: remove backups mais antigos que -Reter dias. O filtro 'db-*' NAO pega o
  # 'pre-reinstalacao-*' (a copia feita antes de apagar o banco), de proposito.
  Get-ChildItem $bakDir -Filter 'db-*.dump.enc' -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-$Reter) } |
    Remove-Item -Force -ErrorAction SilentlyContinue

  # Poda dos LOGS: o NSSM rotaciona por tamanho mas nunca apaga o rotacionado; ja houve
  # log de 445 MB em loja. Aproveita a janela diaria e limpa o que passou de 30 dias.
  try {
    Get-ChildItem $logDir -File -Include '*.log', '*.log.*', 'instalar-*.log', 'atualizar-*.log' -Recurse -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -ne 'backup.log' -and $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  } catch {}

  Reg ("OK: {0} ({1} MB cifrados, retencao {2}d)" -f (Split-Path $destino -Leaf), [int]($enc.Length / 1MB), $Reter)
  Gravar-Resultado $true $null (Split-Path $destino -Leaf) $enc.Length
} catch {
  $msg = $_.Exception.Message
  Reg "FALHOU: $msg"
  # Nunca deixar o dump em texto puro para tras (era o efeito colateral do erro antigo).
  Apagar-Temp
  Gravar-Resultado $false $msg $null 0
  throw
}
