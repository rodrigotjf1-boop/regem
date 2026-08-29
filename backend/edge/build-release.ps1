# build-release.ps1 — PREPARA um release do edge de forma REPRODUZÍVEL e VERIFICADA.
#
# Nasceu do incidente do .exe 1.20 quebrado: o build saiu de uma árvore 158 commits
# atrás do origin/main e com o web como pasta (next truncado). Este script fecha esse
# buraco: sincroniza com o origin/main, rebuilda do zero, empacota e roda o preflight.
# NÃO compila o .exe (isso é o Inno, você que roda) — só deixa TUDO pronto e verde.
#
# Uso (rode na raiz do repo, C:\Regen):
#   powershell -ExecutionPolicy Bypass -File backend\edge\build-release.ps1 -Versao 1.21.0
#   ...opções: -PularWebBuild -PularBackBuild  (pula rebuilds se já fez agora)
#
# ⚠️ FECHE o `npm run dev` do frontend antes (next build corrompe o dev em andamento).

param(
  [Parameter(Mandatory = $true)][string]$Versao,
  [switch]$PularWebBuild,
  [switch]$PularBackBuild
)
$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path  # C:\Regen
Set-Location $repo
function Passo($m) { Write-Host "`n==== $m ====" -ForegroundColor Cyan }
function Abortar($m) { Write-Host "ABORTADO: $m" -ForegroundColor Red; exit 1 }

# 1) FONTE limpa e no origin/main (a regra que foi violada no 1.20) ------------
Passo "1/6  Sincronizar com origin/main (fonte da verdade)"
git fetch origin --quiet
$sujo = (git status --porcelain) | Where-Object { $_ -match 'backend/(edge|src)|frontend/src|database' }
if ($sujo) {
  Write-Host ($sujo -join "`n") -ForegroundColor Yellow
  Abortar "há mudanças de código não-commitadas. Guarde antes (git stash push -u -m pre-release) — um release tem que sair LIMPO do origin/main."
}
git merge --ff-only origin/main
if ($LASTEXITCODE -ne 0) { Abortar "ff-only falhou (o main local divergiu). Resolva com o time antes de buildar." }
$atras = (git rev-list --count HEAD..origin/main).Trim()
if ($atras -ne '0') { Abortar "ainda $atras commit(s) atrás do origin/main." }
Write-Host "OK — main == origin/main ($(git log -1 --format=%h))" -ForegroundColor Green

# 2) Alinhar a versão no .iss (version.txt sai do EDGE_VERSAO no package.mjs) ---
Passo "2/6  Carimbar versão $Versao no regem-edge.iss"
$iss = Join-Path $PSScriptRoot 'regem-edge.iss'
$txt = Get-Content $iss -Raw
$txt = $txt -replace '#define\s+AppVer\s+"[^"]*"', ('#define AppVer  "' + $Versao + '"')
Set-Content $iss -Value $txt -Encoding UTF8 -NoNewline
Write-Host "OK — AppVer = $Versao" -ForegroundColor Green

# 3) Rebuild do frontend (gera .next/standalone com o código atual) ------------
if (-not $PularWebBuild) {
  Passo "3/6  Build do frontend (feche o npm run dev antes!)"
  Set-Location (Join-Path $repo 'frontend')
  npm ci; if ($LASTEXITCODE -ne 0) { Abortar "npm ci (frontend) falhou." }
  npm run build; if ($LASTEXITCODE -ne 0) { Abortar "next build (frontend) falhou." }
  Set-Location $repo
} else { Write-Host "`n(3/6 pulado: -PularWebBuild)" -ForegroundColor DarkGray }

# 4) Rebuild do backend ---------------------------------------------------------
if (-not $PularBackBuild) {
  Passo "4/6  Build do backend"
  Set-Location (Join-Path $repo 'backend')
  npm ci; if ($LASTEXITCODE -ne 0) { Abortar "npm ci (backend) falhou." }
  npm run build; if ($LASTEXITCODE -ne 0) { Abortar "build (backend) falhou." }
  Set-Location $repo
} else { Write-Host "`n(4/6 pulado: -PularBackBuild)" -ForegroundColor DarkGray }

# 5) Empacotar (gera regem-edge-dist com web.tar + version.txt) -----------------
Passo "5/6  Empacotar (package.mjs → regem-edge-dist)"
Set-Location (Join-Path $repo 'backend')
$env:EDGE_VERSAO = $Versao
node edge/package.mjs; if ($LASTEXITCODE -ne 0) { Abortar "package.mjs falhou." }
Set-Location $repo

# 6) PREFLIGHT — o guarda que teria pego o 1.20 --------------------------------
Passo "6/6  Preflight (verifica web.tar/next, keyset, versão)"
node backend/edge/preflight-release.mjs $Versao
if ($LASTEXITCODE -ne 0) { Abortar "preflight reprovou (veja acima). NÃO gere o .exe/.zip." }

# Pronto -----------------------------------------------------------------------
Write-Host "`n========================================================" -ForegroundColor Green
Write-Host " TUDO OK — release $Versao pronto e VERIFICADO." -ForegroundColor Green
Write-Host " .exe : compile  backend\edge\regem-edge.iss  no Inno Setup." -ForegroundColor Green
Write-Host " .zip : edge\publicar.ps1 (sobe o regem-edge-$Versao.zip)." -ForegroundColor Green
Write-Host " Depois: registre em RELEASES.md." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Green
