# Regem Edge - para (e opcionalmente REMOVE) os servicos/tarefas do edge, liberando
# os arquivos travados. Usado pela Fase 0 do instalar-tudo.ps1 (reinstalacao) e avulso.
# ASCII-only de proposito: um .ps1 SEM BOM e lido como ANSI no PowerShell 5.1, entao
# evitamos acentos/emoji para nao quebrar.
#
# Uso (PowerShell como Administrador):
#   .\parar-servicos.ps1                 # so para os servicos
#   .\parar-servicos.ps1 -Remover        # para E remove servicos + tarefas (desinstalar)
#   .\parar-servicos.ps1 -Base C:\regem-edge
#
# =====================================================================================
# QUADRO DE CENARIOS DE INSTALACAO NO WINDOWS (o que o instalador trata)
# -------------------------------------------------------------------------------------
#  Cenario                              | Deteccao                         | Acao
# -------------------------------------------------------------------------------------
#  1. Maquina limpa (1a vez)            | sem servicos, sem pgdata         | instala normal
#  2. Reinstalacao (mesma versao)       | servicos/pgdata existem          | para servicos,
#                                       |                                  | reusa senha/pgdata
#  3. Versao anterior instalada         | servicos existem                 | para+substitui arquivos
#  4. Install anterior com ERRO         | arquivos parciais/.env travado   | destrava .env, refaz
#  5. Servico rodando (trava arquivo)   | Status=Running                   | Fase 0 para antes de copiar
#  6. Processo node/postgres residual   | exe sob C:\regem-edge            | mata so os do edge
#  7. .env.local com ACL so-leitura     | icacls restrito de versao antiga | icacls /reset + attrib -R
#  8. PowerShell 32-bit (WOW64)         | Is64BitProcess=false             | re-lanca em 64-bit (sysnative)
#  9. Windows 32-bit                    | Is64BitOperatingSystem=false     | aborta com aviso (bin sao x64)
# 10. Sem privilegio de admin           | nao esta no grupo Administrators | aborta (o .iss eleva)
# 11. Porta 5432/3001/3002 ocupada por  | processo residual do edge        | morto no passo 6; se for de
#     outro processo do edge            |                                  | terceiro, segue e loga
# 12. Update 1.6.0 pela metade          | arquivos sumindo (sync/web/pg)   | reinstalacao limpa recompoe
# =====================================================================================
param(
  [string]$Base = "C:\regem-edge",
  [switch]$Remover
)
$ErrorActionPreference = "SilentlyContinue"
function Log($m) { Write-Host ("[{0}] {1}" -f (Get-Date -Format HH:mm:ss), $m) }

$servicos = @('RegemEdgeApi', 'RegemEdgeSync', 'RegemEdgeImpressao', 'RegemEdgeWeb', 'RegemEdgePg')
$nssm = Join-Path $Base 'nssm\nssm.exe'

# 1) Para os servicos (nssm se houver; sempre reforca com Stop-Service).
foreach ($s in $servicos) {
  if (-not (Get-Service -Name $s -ErrorAction SilentlyContinue)) { continue }
  Log "parando $s..."
  if (Test-Path $nssm) { & $nssm stop $s | Out-Null }
  Stop-Service -Name $s -Force -ErrorAction SilentlyContinue
  for ($i = 0; $i -lt 20; $i++) {
    $st = (Get-Service -Name $s -ErrorAction SilentlyContinue).Status
    if ($st -ne 'Running') { break }
    Start-Sleep -Milliseconds 500
  }
}

# 2) Mata processos node/postgres RESIDUAIS que rodam de dentro de C:\regem-edge
#    (nao toca em node/postgres de outros programas da maquina).
try {
  $b = $Base.ToLower()
  Get-CimInstance Win32_Process -Filter "Name='node.exe' OR Name='postgres.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.ToLower().StartsWith($b) } |
    ForEach-Object {
      Log ("matando processo residual PID {0} ({1})" -f $_.ProcessId, $_.Name)
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
} catch {}

# 3) Remocao (desinstalacao): apaga servicos + tarefas agendadas.
if ($Remover) {
  foreach ($s in $servicos) {
    if (-not (Get-Service -Name $s -ErrorAction SilentlyContinue)) { continue }
    Log "removendo servico $s..."
    if (Test-Path $nssm) { & $nssm remove $s confirm | Out-Null }
    & sc.exe delete $s | Out-Null
  }
  foreach ($t in @('RegemEdgeUpdate', 'RegemEdgeRollback')) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
      Log "removendo tarefa $t..."
      Unregister-ScheduledTask -TaskName $t -Confirm:$false -ErrorAction SilentlyContinue
    }
  }
}
Log "pronto."
