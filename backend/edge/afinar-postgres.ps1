# Regem Edge - afinar-postgres.ps1  (OPT-IN: NAO roda no install automatico)
#
# Aplica um tuning CONSERVADOR no Postgres local da loja. So entram ajustes que:
#   (a) recarregam por SIGHUP (pg_ctl reload) - NAO exigem restart do servico;
#   (b) NAO alocam memoria compartilhada - assim nao ha risco de o Postgres nao subir.
# shared_buffers e pg_stat_statements ficam COMENTADOS abaixo (exigem restart +
# validacao no hardware real da loja). Rode no PC do edge, como Administrador, depois de
# instalar. E idempotente: marca um bloco e nao duplica em execucoes repetidas.
#
# Uso:
#   .\afinar-postgres.ps1 -PgData "C:\regem-edge\pgdata" -PgBin "C:\regem-edge\pgsql\bin"
param(
  [string]$PgData = "C:\regem-edge\pgdata",
  [string]$PgBin  = "C:\regem-edge\pgsql\bin"
)
$ErrorActionPreference = "Stop"

$conf = Join-Path $PgData "postgresql.conf"
if (-not (Test-Path $conf)) { throw "postgresql.conf nao encontrado em $conf (confira -PgData)." }

$marca = "# === Regem tuning (afinar-postgres.ps1) ==="
if ((Get-Content $conf -Raw) -match [regex]::Escape($marca)) {
  Write-Host "Tuning ja aplicado (marca presente no postgresql.conf). Nada a anexar."
} else {
  # effective_cache_size ~50% da RAM: e apenas DICA do planner (nao aloca memoria).
  $ramMB = [math]::Round((Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory / 1MB)
  $ecsMB = [math]::Max(512, [math]::Round($ramMB * 0.5))
  $linhas = @(
    "",
    $marca,
    "effective_cache_size = ${ecsMB}MB   # dica do planner (nao aloca) ~50% da RAM",
    "work_mem = 16MB                      # memoria por operacao de sort/hash",
    "maintenance_work_mem = 128MB         # vacuum / create index mais rapidos",
    "checkpoint_completion_target = 0.9   # espalha o checkpoint (menos pico de I/O)",
    "wal_compression = on                 # reduz o I/O de WAL",
    "log_checkpoints = off                # reduz o volume de log",
    "autovacuum_naptime = 30s             # vacuum mais frequente (tabelas com churn)",
    "autovacuum_vacuum_scale_factor = 0.05",
    "autovacuum_analyze_scale_factor = 0.02",
    "# --- exigem RESTART + validacao no hardware (deixados COMENTADOS de proposito) ---",
    "# shared_buffers = 512MB             # ~25% da RAM; RAM baixa pode impedir o boot - testar",
    "# shared_preload_libraries = 'pg_stat_statements'  # observabilidade de query lenta (restart)",
    ""
  )
  Add-Content -Path $conf -Value ($linhas -join "`r`n") -Encoding ascii
  Write-Host "Tuning anexado ao postgresql.conf (RAM ${ramMB}MB, effective_cache_size ${ecsMB}MB)."
}

# Recarrega por SIGHUP no servico que JA esta no ar (NUNCA pg_ctl start/stop - evita o
# conflito de porta/2o postmaster que ja travou a instalacao). Best-effort.
try {
  & (Join-Path $PgBin "pg_ctl.exe") reload -D $PgData | Out-Null
  Write-Host "pg_ctl reload OK - settings SIGHUP ativos sem restart."
} catch {
  Write-Warning "Nao consegui recarregar via pg_ctl reload. Reinicie o servico RegemEdgePg para aplicar."
}
