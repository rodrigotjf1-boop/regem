# HORA CERTA NO SERVIDOR DA LOJA (ERR-618, 1.30.16).
#
# O Windows do servidor da loja piloto nunca sincronizou a hora: "Fonte: Local CMOS Clock", 9 s atrasado em 25/11/2026, e
# saltava a cada volta da suspensao. O servidor decide conflito pela hora (o ultimo que gravou vence) e as metricas de
# atraso dos pedidos usam o relogio dele - com a hora errada, as duas coisas erram calado.
#
# Liga a sincronizacao pela internet nos servidores do NTP.br: servico w32time automatico, consulta de hora em hora, e uma
# sincronizacao agora. O instalador chama este script no fim (modo Servidor); best-effort: nunca derruba a instalacao.
# Idempotente: rodar de novo so reaplica a mesma configuracao.
#
# PowerShell 5.1, so ASCII (V19, V52). -SoMostrar lista o que faria, sem mexer em nada (o teste usa).
param(
  [string[]]$Servidores = @('a.ntp.br', 'b.ntp.br'),
  [int]$IntervaloSeg = 3600,
  [switch]$SoMostrar
)
$ErrorActionPreference = 'Stop'

# 0x9 = SpecialInterval (0x1) + Client (0x8): cada servidor e consultado a cada SpecialPollInterval segundos.
function Comandos-DaHora([string[]]$servidores, [int]$intervalo) {
  $peers = ($servidores | ForEach-Object { '{0},0x9' -f $_ }) -join ' '
  return @(
    @{ tipo = 'servico'; nome = 'w32time'; inicio = 'Automatic' },
    @{ tipo = 'registro'; chave = 'HKLM:\SYSTEM\CurrentControlSet\Services\W32Time\TimeProviders\NtpClient'; valor = 'SpecialPollInterval'; dado = $intervalo },
    @{ tipo = 'w32tm'; args = @('/config', ('/manualpeerlist:' + $peers), '/syncfromflags:manual', '/reliable:no', '/update') },
    @{ tipo = 'reiniciar'; nome = 'w32time' },
    @{ tipo = 'w32tm'; args = @('/resync', '/rediscover') }
  )
}

$comandos = Comandos-DaHora $Servidores $IntervaloSeg
if ($SoMostrar) {
  $comandos | ConvertTo-Json -Depth 4 -Compress
  exit 0
}

foreach ($c in $comandos) {
  switch ($c.tipo) {
    'servico' {
      Set-Service -Name $c.nome -StartupType $c.inicio
      if ((Get-Service -Name $c.nome).Status -ne 'Running') { Start-Service -Name $c.nome }
    }
    'registro' {
      if (Test-Path $c.chave) { Set-ItemProperty -Path $c.chave -Name $c.valor -Value $c.dado -Type DWord }
    }
    'reiniciar' { Restart-Service -Name $c.nome -Force }
    'w32tm' {
      # sem internet agora o resync falha; nao e erro da instalacao: o servico tenta de novo sozinho de hora em hora
      & w32tm @($c.args) | Out-Null
    }
  }
}

$fonte = ((& w32tm /query /source) | Out-String).Trim()
Write-Output ('fonte da hora: ' + $fonte)
