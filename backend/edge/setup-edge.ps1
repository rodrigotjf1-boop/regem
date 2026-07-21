# Regem Edge — setup automático no PC da loja (não interativo).
# Pré: pasta do edge copiada, backend/.env.local JÁ preenchido, Node/Postgres/NSSM/OpenSSL instalados.
# Uso (PowerShell como Administrador):
#   .\edge\setup-edge.ps1 -Raiz "C:\regem-edge\backend" -PgSenha "SENHA" -IP "192.168.1.2"
param(
  [string]$Raiz = "C:\regem-edge\backend",
  [Parameter(Mandatory=$true)][string]$PgSenha,
  [Parameter(Mandatory=$true)][string]$IP
)
$ErrorActionPreference = "Stop"
Set-Location $Raiz

if (-not (Test-Path "$Raiz\.env.local")) { throw "Falta o backend/.env.local (copie do .env.local.example e preencha)." }

Write-Host "1/5 · Dependências…"
npm ci --omit=dev

Write-Host "2/5 · Banco local (regem_local)…"
node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:'postgresql://postgres:$PgSenha@localhost:5432/postgres'});await c.connect();await c.query('create database regem_local').catch(()=>{});await c.end()})()"
node scripts\apply-all-local.mjs

Write-Host "3/5 · Certificado local (HTTPS na LAN)…"
node edge\gen-cert.mjs $IP

Write-Host "4/5 · Serviços do Windows (auto-start)…"
& "$Raiz\edge\instalar-servicos.ps1" -Raiz $Raiz

Write-Host "5/5 · Verificação…"
Start-Sleep -Seconds 3
try {
  $r = Invoke-RestMethod -Uri "http://localhost:3001/api/v1/ping" -SkipCertificateCheck -TimeoutSec 5
  Write-Host "OK · /ping respondeu: $($r | ConvertTo-Json -Compress)"
} catch { Write-Warning "Não respondeu ainda no /ping — veja os logs em $Raiz\logs\" }

Write-Host "`nConcluído. Confie o edge\certs\ca.pem nos clientes e aponte-os para https://regem.local:3001 (ou https://$IP:3001)."
