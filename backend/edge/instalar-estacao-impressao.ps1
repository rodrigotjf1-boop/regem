# Regem - instala o "REGEM NESTE PC" (a estacao de impressao) neste PC (modo cliente do instalador;
# central de impressao, fase 1, PR 4b; conexao PC <-> servidor, parte 2). Registra o servico
# RegemEstacaoImpressao, que mantem o PC ligado ao servidor da loja (acha o servidor quando o roteador
# troca o IP dele e anota regem.local no hosts) e imprime as impressoras ligadas nesta estacao. Vai em
# todo PC cliente, mesmo sem impressora (decisao D1); o codigo de 6 digitos (Configuracoes >
# Equipamentos > Estacao de impressao > Gerar codigo) so pareia a impressora. O icone da bandeja e
# registrado pelo proprio instalador.
#
# O codigo vem num ARQUIVO temporario e e apagado na hora: nunca na linha de comando (ficaria no log).
# Sem codigo (reinstalacao), mantem o pareamento que ja existe na pasta de dados.
# Se o codigo falhar (venceu, digitado errado), o servico e instalado assim mesmo: o icone ao lado do
# relogio tem "Parear com codigo..." - a instalacao do PC nao para por isso.
#
# Uso (o instalar-tudo.ps1 chama, elevado):
#   instalar-estacao-impressao.ps1 -Raiz C:\regem-edge\backend -ServidorHost 192.168.0.10 -CodigoArq <arq>
# Saida: a ULTIMA linha diz o resultado (PAREADA / MANTIDA / SEM-PAREAMENTO: <motivo>).
param(
  [Parameter(Mandatory = $true)][string]$Raiz,
  [string]$ServidorHost = "",
  [string]$CodigoArq = "",
  [string]$Versao = ""
)
$ErrorActionPreference = "Stop"

$app = Split-Path $Raiz -Parent
$node = Join-Path $app 'node\node.exe'
if (-not (Test-Path $node)) {
  $c = Get-Command node -ErrorAction SilentlyContinue
  if ($c) { $node = $c.Source } else { throw "Node nao encontrado em $app\node" }
}
$nssm = Join-Path $app 'nssm\nssm.exe'
if (-not (Test-Path $nssm)) {
  $c = Get-Command nssm -ErrorAction SilentlyContinue
  if ($c) { $nssm = $c.Source } else { throw "NSSM nao encontrado em $app\nssm" }
}
$script = Join-Path $Raiz 'edge\estacao-impressao.mjs'
if (-not (Test-Path $script)) { throw "estacao-impressao.mjs nao encontrado em $Raiz\edge" }

# Pasta de DADOS da estacao (fora do backend\: o .env.local do servidor da loja nunca e tocado).
$dados = Join-Path $app 'estacao'
$logs = Join-Path $dados 'logs'
New-Item -ItemType Directory -Force $dados | Out-Null
New-Item -ItemType Directory -Force $logs | Out-Null
$servico = 'RegemEstacaoImpressao'

# 1) Reinstalacao: para o servico antes de parear (o pareamento grava o .env.local que ele le).
$ErrorActionPreference = "Continue"
& $nssm stop $servico 2>$null | Out-Null

# 2) Pareia. O codigo sai do arquivo, o arquivo e apagado, e o codigo vai ao node pelo ambiente.
$resultado = ''
if ($CodigoArq -and (Test-Path $CodigoArq)) {
  $codigo = (Get-Content -Path $CodigoArq -Raw).Trim()
  # .NET e nao Remove-Item: no PowerShell 5.1 o Remove-Item falha com o caminho curto do TEMP
  # (C:\Users\USUARI~1\..., usuario com acento) e o codigo ficava no disco (ERR-243).
  try { [System.IO.File]::Delete($CodigoArq) } catch { }
  $env:ESTACAO_RAIZ = $dados
  $env:ESTACAO_CODIGO = $codigo
  $argsPar = @($script, '--parear')
  if ($ServidorHost) { $argsPar += @('--servidor', $ServidorHost) }
  # Cada linha como TEXTO: no PowerShell 5.1 a saida de erro do node vem embrulhada (CategoryInfo...).
  $saida = (& $node @argsPar 2>&1 | ForEach-Object { "$_" } | Out-String)
  $ok = ($LASTEXITCODE -eq 0)
  Remove-Item Env:ESTACAO_CODIGO -ErrorAction SilentlyContinue
  if ($ok) {
    $resultado = 'PAREADA'
  } else {
    $motivo = ($saida -split "`r?`n" | Where-Object { $_ -match 'pareou' } | Select-Object -Last 1)
    if (-not $motivo) { $motivo = ($saida.Trim() -split "`r?`n" | Select-Object -Last 1) }
    $resultado = "SEM-PAREAMENTO: $motivo"
  }
} elseif (Test-Path (Join-Path $dados '.env.local')) {
  $resultado = 'MANTIDA'
} else {
  $resultado = 'SEM-PAREAMENTO: nenhum codigo informado'
}

# 3) Servico do Windows: sobe com o PC, mesmo sem ninguem logado; reinicia em qualquer saida.
& $nssm remove $servico confirm 2>$null | Out-Null
$ErrorActionPreference = "Stop"
& $nssm install $servico $node $script | Out-Null
& $nssm set $servico AppDirectory $Raiz | Out-Null
& $nssm set $servico DisplayName 'Regem neste PC (estacao de impressao)' | Out-Null
& $nssm set $servico Description 'Mantem este PC ligado ao servidor da loja (acha o servidor se o IP dele mudar) e imprime os cupons nas impressoras ligadas nesta estacao (Regem).' | Out-Null
$envs = @("ESTACAO_RAIZ=$dados")
if ($Versao) { $envs += "APP_VERSION=$Versao" }
if ($ServidorHost) { $envs += "ESTACAO_SERVIDOR=$ServidorHost" }
& $nssm set $servico AppEnvironmentExtra @envs | Out-Null
& $nssm set $servico Start SERVICE_AUTO_START | Out-Null
& $nssm set $servico AppExit Default Restart | Out-Null
& $nssm set $servico AppThrottle 5000 | Out-Null
& $nssm set $servico AppRestartDelay 3000 | Out-Null
& $nssm set $servico AppStdout (Join-Path $logs 'estacao.log') | Out-Null
& $nssm set $servico AppStderr (Join-Path $logs 'estacao.err.log') | Out-Null
& $nssm set $servico AppRotateFiles 1 | Out-Null
& $nssm set $servico AppRotateOnline 1 | Out-Null
& $nssm set $servico AppRotateBytes 5242880 | Out-Null
& $nssm start $servico | Out-Null

Write-Host $resultado
