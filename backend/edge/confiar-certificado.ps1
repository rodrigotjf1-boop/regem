# confiar-certificado.ps1
# Instala o certificado da CA local do Regem no repositorio "Autoridades de
# Certificacao Raiz Confiaveis" deste Windows, para o aparelho (KDS/PDV/ponto)
# abrir o servidor local por HTTPS sem o aviso de "nao seguro".
#
# Uso mais facil: clique com o botao direito no arquivo > "Executar com o
# PowerShell" e aceite o aviso de administrador. Ou pelo terminal:
#     .\confiar-certificado.ps1 -Servidor 192.168.0.10
#
# -Servidor: IP ou nome do PC servidor na rede (o instalador mostrou). Se vazio,
#            usa regem.local. -Porta: padrao 3001.
#
# Observacao: no PC do proprio servidor isso ja e feito pelo instalador. Este
# script e para os OUTROS aparelhos Windows da loja. Em tablets Android nao ha
# como automatizar (limitacao do sistema) - use a aba "Como funciona".

param(
  [string]$Servidor = "regem.local",
  [int]$Porta = 3001
)

$ErrorActionPreference = "Stop"

# 1) Exige administrador (addstore -Root precisa). Reinicia elevado se preciso.
$souAdmin = ([Security.Principal.WindowsPrincipal] `
  [Security.Principal.WindowsIdentity]::GetCurrent() `
).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $souAdmin) {
  Write-Host "Pedindo permissao de administrador..."
  Start-Process powershell -Verb RunAs -ArgumentList `
    "-ExecutionPolicy Bypass -File `"$PSCommandPath`" -Servidor $Servidor -Porta $Porta"
  return
}

Write-Host "Regem - confiar certificado do servidor $Servidor`:$Porta" -ForegroundColor Cyan

# 2) Baixa o ca.pem do servidor. O cert ainda NAO e confiavel, entao o download
#    precisa ignorar a validacao TLS. PS 5.1 NAO tem -SkipCertificateCheck, entao
#    usamos o callback do ServicePointManager + TLS 1.2 (licao do instalador).
$destino = Join-Path $env:TEMP "regem-ca.crt"
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  $antigoCb = [Net.ServicePointManager]::ServerCertificateValidationCallback
  [Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
  $url = "https://$Servidor`:$Porta/ca.pem"
  Write-Host "Baixando $url ..."
  Invoke-WebRequest -Uri $url -OutFile $destino -UseBasicParsing
} catch {
  Write-Host "Falha ao baixar o certificado: $($_.Exception.Message)" -ForegroundColor Red
  Write-Host "Confira se o servidor esta ligado e o IP/nome esta certo." -ForegroundColor Yellow
  Read-Host "Enter para sair"
  return
} finally {
  [Net.ServicePointManager]::ServerCertificateValidationCallback = $antigoCb
}

# 3) Instala no repositorio Raiz Confiavel da maquina.
Write-Host "Instalando o certificado..."
$saida = & certutil.exe -addstore -f Root $destino 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "certutil falhou:" -ForegroundColor Red
  Write-Host $saida
  Read-Host "Enter para sair"
  return
}

Remove-Item $destino -ErrorAction SilentlyContinue
Write-Host ""
Write-Host "Pronto! Este aparelho ja confia no servidor Regem." -ForegroundColor Green
Write-Host "Feche e abra o navegador; o aviso de 'nao seguro' some." -ForegroundColor Green
Read-Host "Enter para sair"
