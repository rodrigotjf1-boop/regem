# Regem Edge — decifra blobs DPAPI (LocalMachine) no BOOT. Lê um arquivo com um
# blob base64 por linha e imprime o texto decifrado, uma linha por blob (mesma ordem).
# Usado por src/secure-env.ts. Só decifra NESTA máquina (a que cifrou com proteger-env.ps1).
param([Parameter(Mandatory = $true)][string]$BlobFile)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
foreach ($b64 in Get-Content -Path $BlobFile) {
  if ([string]::IsNullOrWhiteSpace($b64)) { Write-Output ""; continue }
  $dec = [System.Security.Cryptography.ProtectedData]::Unprotect(
    [Convert]::FromBase64String($b64.Trim()), $null,
    [System.Security.Cryptography.DataProtectionScope]::LocalMachine)
  Write-Output ([System.Text.Encoding]::UTF8.GetString($dec))
}
