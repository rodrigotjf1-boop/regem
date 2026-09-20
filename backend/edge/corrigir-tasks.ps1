# Regem Edge - RECUPERACAO: registra as tarefas RegemEdgeUpdate/RegemEdgeRollback
# em edges onde o instalar-servicos.ps1 falhou ao registra-las (bug do valor de enum
# -MultipleInstances "StopExisting", que nao existe em algumas versoes do Windows e
# fazia o Register-ScheduledTask inteiro falhar). Idempotente (-Force). Rode como
# Administrador. Nao mexe em servicos nem no banco.
#   .\corrigir-tasks.ps1                         (usa C:\regem-edge\backend)
#   .\corrigir-tasks.ps1 -Raiz "D:\...\backend"
param([string]$Raiz = "C:\regem-edge\backend")
$ErrorActionPreference = "Stop"

$conta = New-ScheduledTaskPrincipal -UserId "SYSTEM" -RunLevel Highest
$cfg   = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
           -ExecutionTimeLimit (New-TimeSpan -Minutes 15)

$upd = Join-Path $Raiz 'edge\atualizar.ps1'
if (Test-Path $upd) {
  $a = New-ScheduledTaskAction -Execute "powershell.exe" `
        -Argument ("-ExecutionPolicy Bypass -NoProfile -File `"{0}`" -Raiz `"{1}`"" -f $upd, $Raiz)
  Register-ScheduledTask -TaskName "RegemEdgeUpdate" -Action $a -Principal $conta -Settings $cfg -Force | Out-Null
  Write-Host "-> RegemEdgeUpdate registrada."
} else { Write-Warning "atualizar.ps1 nao encontrado em $upd" }

# BACKUP DIARIO: antes so o instalador (.exe) registrava esta tarefa. Loja que recebeu
# o codigo novo por .zip ficava com o backup.ps1 no disco e SEM tarefa nenhuma - isto e,
# sem backup, sem aviso. Aqui ela e criada/consertada tambem.
$bk = Join-Path $Raiz 'edge\backup.ps1'
if (Test-Path $bk) {
  $ab = New-ScheduledTaskAction -Execute "powershell.exe" `
         -Argument ("-NoProfile -ExecutionPolicy Bypass -File `"{0}`" -Raiz `"{1}`"" -f $bk, $Raiz)
  $tb = New-ScheduledTaskTrigger -Daily -At 3am
  $cb = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
          -ExecutionTimeLimit (New-TimeSpan -Minutes 60) `
          -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName "RegemEdgeBackup" -Action $ab -Trigger $tb -Settings $cb -Principal $conta -Force | Out-Null
  Write-Host "-> RegemEdgeBackup registrada (03:00, recupera execucao perdida)."
} else { Write-Warning "backup.ps1 nao encontrado em $bk" }

$rev = Join-Path $Raiz 'edge\reverter.ps1'
if (Test-Path $rev) {
  $ar = New-ScheduledTaskAction -Execute "powershell.exe" `
         -Argument ("-ExecutionPolicy Bypass -NoProfile -File `"{0}`" -Raiz `"{1}`"" -f $rev, $Raiz)
  Register-ScheduledTask -TaskName "RegemEdgeRollback" -Action $ar -Principal $conta -Settings $cfg -Force | Out-Null
  Write-Host "-> RegemEdgeRollback registrada."
} else { Write-Warning "reverter.ps1 nao encontrado em $rev" }

Write-Host "`nTarefas agendadas do Regem:"
Get-ScheduledTask -TaskName "RegemEdge*" | Select-Object TaskName, State | Format-Table -AutoSize
