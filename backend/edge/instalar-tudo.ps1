# Regem Edge - INSTALACAO AUTOMATICA (chamado pelo instalador .exe, elevado/Admin).
#
# Faz TUDO que e local, sem intervencao:
#   - usa Postgres/Node EMBUTIDOS se existirem ao lado do app (senao, os do sistema)
#   - inicializa o Postgres local + cria o banco regem_local (senha aleatoria)
#   - gera JWT_SECRET aleatorio, detecta o IP da LAN
#   - escreve o .env.local ja preenchido (nada de notepad)
#   - instala deps, roda migrations, gera o certificado e sobe os servicos
#   - confia o ca.pem NESTA maquina
#   - (opcional) ativa a licenca se receber o token
#
# So depende de valores da NUVEM, passados por parametro (o instalador coleta no wizard):
#   Self-service (recomendado): -Email -Senha [-UnidadeId]
#   Manual (fallback):          -SyncToken -AtivacaoToken -UnidadeId
#
# Uso direto (fora do instalador), como Administrador:
#   .\edge\instalar-tudo.ps1 -Raiz "C:\regem-edge\backend" -UnidadeId "<uuid>" -SyncToken "<token>" `
#       -LicensePublicKey "<b64>" -AtivacaoToken "<token-licenca>"
param(
  [string]$Raiz = "C:\regem-edge\backend",
  [string]$UnidadeId = "",
  # Self-service (recomendado): a conta C&O provisiona sozinha.
  [string]$Email = "",
  [string]$Senha = "",
  # Modo manual (fallback): token de sync + token de ativacao emitidos na nuvem.
  [string]$SyncToken = "",
  [string]$AtivacaoToken = "",
  [string]$LicensePublicKey = "",
  [string]$CloudApi = "https://api.dmsregem.com/api/v1",
  [int]$Porta = 3001,
  [int]$PgPorta = 5432
)

$ErrorActionPreference = "Stop"
$root = $Raiz
$base = Split-Path $root -Parent          # C:\regem-edge
Set-Location $root                        # cwd = raiz do backend (resolve node_modules + caminhos relativos)
$logDir = Join-Path $root "logs"; New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir ("instalar-{0}.log" -f (Get-Date -Format "yyyyMMdd-HHmmss"))
# Grava TODA a saida (inclusive erros de npm/node/initdb/postgres) no log — o
# arquivo fica em logs\instalar-*.log para enviar ao suporte quando algo falhar.
Start-Transcript -Path $log -Force -ErrorAction SilentlyContinue | Out-Null
trap { Stop-Transcript -ErrorAction SilentlyContinue | Out-Null }
function Diga($m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $m) }
function Rand($n) { -join ((48..57) + (65..90) + (97..122) | Get-Random -Count $n | ForEach-Object { [char]$_ }) }

Diga "=== Regem Edge - instalacao automatica ==="

# ---- 0) Resolver ferramentas: preferir EMBUTIDAS (ao lado do app) ----
$nodeDir = Join-Path $base "node"          # node portatil (node.exe, npm.cmd)
$pgDir   = Join-Path $base "pgsql"         # postgres portatil (bin\initdb.exe, pg_ctl.exe...)
$nssm    = Join-Path $base "nssm\nssm.exe"
$embutido = @{ node = (Test-Path (Join-Path $nodeDir "node.exe")); pg = (Test-Path (Join-Path $pgDir "bin\pg_ctl.exe")); nssm = (Test-Path $nssm) }
if ($embutido.node) { $env:Path = $nodeDir + ';' + $env:Path; Diga 'Node: embutido' } else { Diga 'Node: do sistema' }
if ($embutido.pg)   { $env:Path = (Join-Path $pgDir 'bin') + ';' + $env:Path; Diga 'Postgres: embutido' } else { Diga 'Postgres: do sistema' }
if (-not $embutido.nssm) { $nssm = "nssm" }  # do PATH
$node = "node"

# ---- 0.1) Pre-flight: checa o ambiente e para cedo com mensagem clara ----
Diga "Verificando o ambiente..."
try { $null = Invoke-WebRequest -Uri "https://registry.npmjs.org/-/ping" -TimeoutSec 8 -UseBasicParsing }
catch { Diga "AVISO: internet nao respondeu (registry npm) - o npm ci pode falhar." }
& $node --version | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "O Node nao executou. Instale o Microsoft Visual C++ Redistributable x64 (https://aka.ms/vs/17/release/vc_redist.x64.exe) e rode de novo."
}
if ($embutido.pg) {
  & (Join-Path $pgDir "bin\postgres.exe") --version | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "O Postgres embutido nao executou - falta runtime do Windows. Instale o Microsoft Visual C++ Redistributable x64 (https://aka.ms/vs/17/release/vc_redist.x64.exe) e rode o instalador de novo."
  }
}

# ---- 0.5) Dependencias ANTES do Postgres (o passo do banco usa o modulo 'pg') ----
# O pacote ja vem com node_modules embutido (instalacao offline). So baixa se, por
# algum motivo, as dependencias nao vieram junto.
if (Test-Path (Join-Path $root "node_modules\pg")) {
  Diga "Dependencias ja embutidas - pulando download."
} else {
  Diga "Instalando dependencias (npm ci)... (precisa de internet)"
  & npm ci --omit=dev
  if ($LASTEXITCODE -ne 0) { throw "npm ci falhou (a loja tem internet?)." }
}

# ---- 1) Postgres local ----
$pgSenha = Rand 24
$pgData = Join-Path $base "pgdata"
if ($embutido.pg) {
  if (-not (Test-Path (Join-Path $pgData "PG_VERSION"))) {
    Diga "Inicializando Postgres embutido em $pgData..."
    $pwfile = Join-Path $env:TEMP ("pgpw-{0}.txt" -f (Get-Random))
    Set-Content -Path $pwfile -Value $pgSenha -NoNewline -Encoding ascii
    & (Join-Path $pgDir "bin\initdb.exe") -U postgres --pwfile=$pwfile -A md5 -E UTF8 --locale=C -D $pgData | Out-Null
    Remove-Item $pwfile -Force
    # O postgres.exe se RECUSA a rodar como conta admin (Sistema Local). O servico
    # roda como "Servico de rede" (NetworkService = SID S-1-5-20, nao-admin) — igual
    # ao instalador oficial do Postgres. Ele precisa ser DONO/ter acesso ao pgdata
    # e ler os binarios do pgsql.
    icacls $pgData /setowner "*S-1-5-20" /T /C /Q | Out-Null
    icacls $pgData /grant "*S-1-5-20:(OI)(CI)F" /T /C /Q | Out-Null
    icacls $pgDir  /grant "*S-1-5-20:(OI)(CI)RX" /T /C /Q | Out-Null
    $pgArgs = '-D "' + $pgData + '" -p ' + $PgPorta
    & $nssm install RegemEdgePg (Join-Path $pgDir "bin\postgres.exe") $pgArgs | Out-Null
    & $nssm set RegemEdgePg ObjectName "NT AUTHORITY\NetworkService" "" | Out-Null
    & $nssm set RegemEdgePg Start SERVICE_AUTO_START | Out-Null
    & $nssm set RegemEdgePg AppStderr "$logDir\RegemEdgePg.err.log" | Out-Null
    & $nssm start RegemEdgePg | Out-Null
    Start-Sleep -Seconds 2
    Diga "Postgres embutido: servico iniciado como Servico de rede (porta $PgPorta)."
  } else {
    Diga "pgdata ja existe - reaproveitando. (Se nao souber a senha, apague $pgData para reinicializar.)"
  }
} else {
  # Postgres do sistema: precisa da senha do superusuario. Tenta 'postgres' padrao;
  # se falhar, o tecnico informa via -PgSenha. Aqui assumimos o param ou 'postgres'.
  if (-not $PSBoundParameters.ContainsKey('PgSenha')) { $pgSenha = "postgres" }
}

# espera o Postgres aceitar conexao (ate ~30s)
$connPg = "postgresql://postgres:$pgSenha@localhost:$PgPorta/postgres"
$okPg = $false
foreach ($i in 1..15) {
  try { & $node -e "const{Client}=require('pg');new Client({connectionString:process.argv[1]}).connect().then(c=>c.end()).then(()=>process.exit(0)).catch(()=>process.exit(1))" $connPg; if ($LASTEXITCODE -eq 0) { $okPg = $true; break } } catch {}
  Start-Sleep -Seconds 2
}
if (-not $okPg) { throw "Postgres nao respondeu em localhost:$PgPorta. Verifique a instalacao/senha." }

Diga "Criando banco regem_local..."
& $node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.argv[1]});await c.connect();await c.query('create database regem_local').catch(()=>{});await c.end()})()" $connPg

# ---- 2) .env.local automatico ----
$jwt = Rand 40
$ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } | Select-Object -First 1).IPAddress
if (-not $ip) { $ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -ne '127.0.0.1' } | Select-Object -First 1).IPAddress }
Diga "IP da LAN detectado: $ip"

# Self-service (G-4b): com e-mail/senha do C&O, a nuvem cria/reusa o equipamento
# servidor_local + ativa a licenca e devolve o SYNC_TOKEN. Sem token manual.
$fingerprint = $env:COMPUTERNAME
if ($Email -and $Senha) {
  Diga "Provisionando pela conta C&O (self-service)..."
  $payload = @{ email = $Email; senha = $Senha; fingerprint = $fingerprint }
  if ($UnidadeId) { $payload.unidadeId = $UnidadeId }
  try {
    $r = Invoke-RestMethod -Method Post -Uri ("{0}/provisionamento/instalar" -f $CloudApi.TrimEnd('/')) `
      -ContentType "application/json" -Body ($payload | ConvertTo-Json -Compress) -TimeoutSec 40
    $SyncToken = $r.syncToken
    Diga "Provisionado: sync token recebido e licenca ativada na nuvem."
  } catch {
    throw "Falha no provisionamento self-service: $($_.Exception.Message)"
  }
}
if (-not $SyncToken) { throw "Sem SYNC_TOKEN. Use -Email/-Senha (self-service) ou -SyncToken (manual)." }

$dbLocal = "postgresql://postgres:$pgSenha@localhost:$PgPorta/regem_local"
$certDir = Join-Path $root "edge\certs"
$envLocal = Join-Path $root ".env.local"
@"
# Gerado automaticamente pelo instalador do Regem Edge - nao editar a mao sem necessidade.
DATABASE_URL=$dbLocal
EDGE_DATABASE_URL=$dbLocal
JWT_SECRET=$jwt
PORT=$Porta
NODE_ENV=production
CORS_ORIGIN=*
EDGE_MODE=true
EDGE_UNIDADE_ID=$UnidadeId
APP_VERSION=1
EDGE_TLS_CERT=$certDir\server.crt
EDGE_TLS_KEY=$certDir\server.key
LICENSE_PUBLIC_KEY_B64=$LicensePublicKey
LICENSE_KID=k1
LICENSE_GRACE_DAYS=30
CLOUD_API=$CloudApi
SYNC_TOKEN=$SyncToken
SYNC_INTERVAL_MS=30000
EDGE_CLIENTES=0
"@ | Set-Content -Path $envLocal -Encoding ascii
Diga ".env.local escrito."

# ---- 3) migrations + certificado + servicos ----
Diga "Aplicando migrations..."; & $node "scripts\apply-all-local.mjs"; if ($LASTEXITCODE -ne 0) { throw "migrations falharam." }
Diga "Gerando certificado HTTPS local ($ip)..."; & $node "edge\gen-cert.mjs" $ip
Diga "Registrando servicos do Windows..."; & "$root\edge\instalar-servicos.ps1" -Raiz $root -Nssm $nssm

# ---- 4) confiar o ca.pem NESTA maquina ----
$ca = Join-Path $certDir "ca.pem"
if (Test-Path $ca) {
  try { Import-Certificate -FilePath $ca -CertStoreLocation Cert:\LocalMachine\Root | Out-Null; Diga "ca.pem confiado nesta maquina." }
  catch { Diga "AVISO: nao consegui confiar o ca.pem automaticamente: $($_.Exception.Message)" }
}

# ---- 5) health-check ----
$okPing = $false
foreach ($i in 1..15) {
  Start-Sleep -Seconds 2
  try { $r = Invoke-WebRequest -Uri ("https://localhost:{0}/api/v1/ping" -f $Porta) -TimeoutSec 5 -SkipCertificateCheck; if ($r.StatusCode -eq 200) { $okPing = $true; break } } catch {}
}
if ($okPing) { Diga "OK - /ping respondeu." } else { Diga "AVISO: /ping ainda nao respondeu; veja os logs em $logDir." }

# ---- 6) (opcional) ativar a licenca via token manual (self-service ja ativou) ----
if ($AtivacaoToken -and -not ($Email -and $Senha)) {
  Diga "Ativando licenca..."
  try {
    $body = @{ token = $AtivacaoToken; fingerprint = $env:COMPUTERNAME } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Method Post -Uri ("https://localhost:{0}/api/v1/provisionamento/ativar" -f $Porta) -ContentType "application/json" -Body $body -SkipCertificateCheck -TimeoutSec 20
    Diga "Licenca ativada (lease recebido)."
  } catch { Diga "AVISO: nao consegui ativar a licenca agora: $($_.Exception.Message). Ative depois pelo /frota." }
}

# ---- 6.5) atalho na area de trabalho para o servidor local ----
try {
  $desktop = [Environment]::GetFolderPath('CommonDesktopDirectory')
  $scut = Join-Path $desktop "Regem (servidor local).url"
  Set-Content -Path $scut -Encoding ascii -Value "[InternetShortcut]`r`nURL=https://localhost:$Porta`r`nIconIndex=0"
  Diga "Atalho criado na area de trabalho: Regem (servidor local) -> https://localhost:$Porta"
} catch { Diga "AVISO: nao consegui criar o atalho na area de trabalho: $($_.Exception.Message)" }

Diga ""
Diga "==================== CONCLUIDO ===================="
Diga "Servidor local: https://${ip}:$Porta  (ou https://regem.local:$Porta)"
Diga "Nos aparelhos clientes (KDS/PDV/Ponto): confie o arquivo $ca e aponte o navegador para o endereco acima."
Diga "Log completo: $log"
Stop-Transcript -ErrorAction SilentlyContinue | Out-Null
