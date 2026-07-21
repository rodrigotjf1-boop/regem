# Regem Edge — cifra os SEGREDOS do .env.local em repouso com DPAPI (LocalMachine).
# O blob resultante (prefixo enc:) só decifra NESTA máquina — copiar o arquivo para
# outro PC torna os segredos inúteis. O app decifra no boot (carregarEnvSeguro em main.ts).
# Idempotente: valores já cifrados (enc:) são ignorados. Rode como Administrador.
#
# Uso: powershell -ExecutionPolicy Bypass -File proteger-env.ps1 -EnvFile "C:\regem-edge\backend\.env.local"
param([Parameter(Mandatory = $true)][string]$EnvFile)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security

# Só estes valores são cifrados (o resto é config não sensível: portas, flags, versão).
$SENSIVEIS = @('DATABASE_URL', 'EDGE_DATABASE_URL', 'JWT_SECRET', 'SYNC_TOKEN')

if (-not (Test-Path $EnvFile)) { throw ".env nao encontrado: $EnvFile" }
$linhas = Get-Content -Path $EnvFile
$saida = New-Object System.Collections.Generic.List[string]
$cifrados = 0

foreach ($linha in $linhas) {
  $m = [regex]::Match($linha, '^\s*([A-Z0-9_]+)\s*=\s*(.*)$')
  if ($m.Success -and $SENSIVEIS -contains $m.Groups[1].Value) {
    $chave = $m.Groups[1].Value
    $valor = $m.Groups[2].Value
    if ($valor.StartsWith('enc:') -or [string]::IsNullOrWhiteSpace($valor)) {
      $saida.Add($linha)   # já cifrado ou vazio — mantém
    } else {
      $bytes = [System.Text.Encoding]::UTF8.GetBytes($valor)
      $enc = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $null, [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
      $b64 = [Convert]::ToBase64String($enc)
      $saida.Add("$chave=enc:$b64")
      $cifrados++
    }
  } else {
    $saida.Add($linha)
  }
}

Set-Content -Path $EnvFile -Value $saida -Encoding ascii
Write-Host "Segredos cifrados: $cifrados (DPAPI LocalMachine). Chaves: $($SENSIVEIS -join ', ')"
