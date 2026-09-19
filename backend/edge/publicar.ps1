# Regem Edge - PUBLICAR uma nova versao (rode na maquina da DISTRIBUICAO; nao vai para a loja).
#
# Dois passos:
#   1) GERAR o .zip (compila, monta o regem-edge-dist, empacota e confere o conteudo):
#        .\edge\publicar.ps1 -Versao 1.30.0 [-SkipBuild]
#   2) Subir o .zip no Supabase Storage (bucket edge-updates, nome exato regem-edge-1.30.0.zip) e
#      ASSINAR o MESMO arquivo com a URL definitiva (nao remonta - remontar mudaria o SHA):
#        .\edge\publicar.ps1 -Versao 1.30.0 -SoAssinar -Url https://.../regem-edge-1.30.0.zip [-ExpiraDias 180]
#      Imprime o que colar no console da distribuicao (Releases -> Publicar release).
#
# O .zip leva as dependencias em node_modules.tar (a loja NAO roda npm ci - ERR-045) e o app em
# web.tar; e gerado pelo tar do Windows (separador "/", padrao ZIP - ERR-054).
param(
  [Parameter(Mandatory = $true)][string]$Versao,
  [string]$Url,
  [int]$ExpiraDias = 180,
  [switch]$SkipBuild,
  [switch]$SoAssinar
)

$ErrorActionPreference = "Stop"
# Chamada NATIVA (node/npm/tar): no PS 5.1, com Stop, uma linha no stderr de um nativo
# redirecionado vira erro FATAL (licao do #457). Aqui roda com Continue e o resultado e julgado
# pelo codigo de saida ($LASTEXITCODE).
function Nativo([scriptblock]$bloco) {
  $ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $bloco 2>&1 | ForEach-Object { Write-Host "$_" } } finally { $ErrorActionPreference = $ea }
}

if ($Versao -notmatch '^\d+\.\d+\.\d+$') { throw "Versao no formato 1.30.0." }
$backend = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path  # ...\backend
$raizRepo = Split-Path $backend -Parent
$zip = Join-Path $raizRepo ("regem-edge-{0}.zip" -f $Versao)
$tarExe = Join-Path $env:SystemRoot 'System32\tar.exe'
Set-Location $backend

if (-not $SoAssinar) {
  if (-not (Test-Path $tarExe)) { throw "tar.exe do Windows nao encontrado (Windows 10 1803+)." }
  if (-not $SkipBuild) {
    Write-Host "-> Compilando backend (npm run build)..."
    Nativo { npm run build }
    if ($LASTEXITCODE -ne 0) { throw "npm run build falhou." }
  }

  Write-Host "-> Montando pacote (node edge/package.mjs)..."
  $env:EDGE_VERSAO = $Versao
  Nativo { node edge/package.mjs }
  if ($LASTEXITCODE -ne 0) { throw "package.mjs falhou." }

  $dist = (Resolve-Path (Join-Path $raizRepo "regem-edge-dist")).Path

  # node_modules -> node_modules.tar (caminhos longos: so o tar preserva - mesma razao do web.tar)
  $tmpTar = Join-Path $raizRepo "_pacote-tmp"
  if (Test-Path $tmpTar) { Remove-Item $tmpTar -Recurse -Force }
  New-Item -ItemType Directory $tmpTar | Out-Null
  Write-Host "-> Empacotando as dependencias (node_modules.tar)..."
  # CONTEUDO da pasta (como o web.tar): o atualizar.ps1 extrai dentro de <novo>\node_modules.
  Nativo { & $tarExe -cf (Join-Path $tmpTar 'node_modules.tar') -C (Join-Path $dist 'node_modules') . }
  if ($LASTEXITCODE -ne 0) { throw "tar do node_modules falhou." }

  if (Test-Path $zip) { Remove-Item $zip -Force }
  Write-Host "-> Gerando $zip ..."
  $itens = Get-ChildItem -Path $dist -Force | Where-Object { $_.Name -ne 'node_modules' } | ForEach-Object { $_.Name }
  Nativo { & $tarExe -a -c -f $zip -C $dist @itens -C $tmpTar node_modules.tar }
  if ($LASTEXITCODE -ne 0) { throw "geracao do .zip falhou (tar rc=$LASTEXITCODE)." }
  Remove-Item $tmpTar -Recurse -Force
} else {
  if (-not $Url) { throw "-SoAssinar exige -Url (endereco definitivo do .zip)." }
  if (-not (Test-Path $zip)) { throw "Nao achei $zip - gere o pacote primeiro (sem -SoAssinar)." }
}

# Conferencia do que a loja vai receber (vale tambem no -SoAssinar)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z = [System.IO.Compression.ZipFile]::OpenRead($zip)
try { $nomes = @($z.Entries | ForEach-Object { $_.FullName }) } finally { $z.Dispose() }
$faltando = @('dist/main.js', 'node_modules.tar', 'web.tar', 'edge/atualizar.ps1', 'edge/atualizacao-comum.ps1',
  'edge/saude-local.mjs', 'edge/verify-update.mjs', 'edge/update-pub.pem', 'scripts/apply-all-local.mjs',
  'dist-manifest.json') | Where-Object { $nomes -notcontains $_ }
if ($faltando) { throw ("O .zip saiu sem: {0} - NAO publique." -f ($faltando -join ', ')) }
$proibidos = @('edge/update-priv.pem', 'edge/sign-update.mjs', 'edge/publicar.ps1', 'scripts/gen-license-keys.mjs') |
  Where-Object { $nomes -contains $_ }
if ($proibidos) { throw ("O .zip levou ferramenta/segredo da distribuicao: {0} - NAO publique." -f ($proibidos -join ', ')) }
if ($nomes | Where-Object { $_.Contains('\') }) { throw "O .zip tem caminho com barra invertida - fora do padrao ZIP." }

$sha = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
$mb = [math]::Round((Get-Item $zip).Length / 1MB, 1)
Write-Host ""
Write-Host "==================== PRONTO ====================" -ForegroundColor Green
Write-Host ("Pacote: {0} ({1} MB)" -f $zip, $mb)
Write-Host ("SHA256: {0}" -f $sha)

if (-not $Url) {
  Write-Host ""
  Write-Host "1) Suba o .zip no Supabase Storage (bucket edge-updates, nome regem-edge-$Versao.zip)." -ForegroundColor Yellow
  Write-Host "2) Assine o MESMO arquivo com a URL definitiva:" -ForegroundColor Yellow
  Write-Host ("   .\edge\publicar.ps1 -Versao {0} -SoAssinar -Url <URL-do-zip>" -f $Versao) -ForegroundColor Yellow
  return
}

Write-Host ""
Write-Host "-> Assinando (Ed25519, v1 + v2 com validade de $ExpiraDias dias)..."
$ea = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
$saidaSig = @(& node (Join-Path $backend 'edge\sign-update.mjs') $Versao $sha $Url "--expira-dias=$ExpiraDias" 2>&1 | ForEach-Object { "$_" })
$rcSig = $LASTEXITCODE
$ErrorActionPreference = $ea
$pega = { param($chave) ($saidaSig | Select-String -Pattern ("{0}=(\S+)" -f $chave) | Select-Object -First 1).Matches.Groups[1].Value }
$sig1 = & $pega 'EDGE_UPDATE_SIG'
$sig2 = & $pega 'EDGE_UPDATE_SIG_V2'
$exp  = & $pega 'EDGE_UPDATE_EXPIRA'
if ($rcSig -ne 0 -or -not $sig1 -or -not $sig2 -or -not $exp) { throw ("Nao consegui assinar. Saida:`n{0}" -f ($saidaSig -join "`n")) }
# Confere como a LOJA vai conferir (chave publica do repositorio).
Nativo { & node (Join-Path $backend 'edge\verify-update.mjs') $Versao $sha $Url $sig2 $exp }
if ($LASTEXITCODE -ne 0) { throw "A assinatura v2 NAO confere com edge\update-pub.pem (rc=$LASTEXITCODE)." }
Nativo { & node (Join-Path $backend 'edge\verify-update.mjs') $Versao $sha $Url $sig1 }
if ($LASTEXITCODE -ne 0) { throw "A assinatura v1 NAO confere com edge\update-pub.pem (rc=$LASTEXITCODE)." }
Write-Host "Assinaturas conferidas com a chave publica." -ForegroundColor Green
Write-Host ""
Write-Host "Console da distribuicao -> Releases -> Publicar release:" -ForegroundColor Cyan
Write-Host ("   Versao:         {0}" -f $Versao)
Write-Host ("   URL:            {0}" -f $Url)
Write-Host ("   SHA-256:        {0}" -f $sha)
Write-Host ("   Assinatura v1:  {0}" -f $sig1)
Write-Host ("   Assinatura v2:  {0}" -f $sig2)
Write-Host ("   Validade (v2):  {0}" -f $exp)
Write-Host "   Distribuicao:   comece pelas lojas piloto (0-10%), depois 25%, 50%, 100%."
