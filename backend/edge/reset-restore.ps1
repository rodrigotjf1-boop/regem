# reset-restore.ps1 - destrava o restore e re-dispara um restore COMPLETO da nuvem.
#
# Use quando o restore ficou incompleto e a UI travou: app/dashboard vazios e o botao
# "Restaurar nuvem" preso em disable ("restaurando..."). Isso acontece se o processo
# morreu no meio de um restore (ex.: a era do "fetch failed" antes do >=1.22): a flag
# 'restaurando' fica presa em 1 e o restore completo nao re-dispara sozinho.
#
# PRE-REQUISITO: o daemon ja tem que estar em >=1.22 (fetch corrigido). Rodar isto no
# 1.21 apenas re-tenta e volta a falhar. Atualize (atualizar.ps1 / reinstale) antes.
#
# O que faz: zera 'restaurando', marca 'restaurar_solicitado=1', zera os cursores
# (restore/pull) e apaga 'restaurado_em' -> no proximo ciclo o daemon puxa TUDO de novo.
# Nao apaga dados locais; so refaz o download da nuvem (idempotente por id).
#
# Uso (PowerShell como Administrador no PC servidor):
#   powershell -ExecutionPolicy Bypass -File C:\regem-edge\backend\edge\reset-restore.ps1

param([string]$Raiz = 'C:\regem-edge\backend')
$ErrorActionPreference = 'Stop'
$edge = Join-Path $Raiz 'edge'
if (-not (Test-Path (Join-Path $edge 'decifrar-env.mjs'))) { throw "nao achei o edge em $edge" }
$node = Join-Path (Split-Path $Raiz -Parent) 'node\node.exe'
if (-not (Test-Path $node)) { $node = 'node' }

# Script node temporario: decifra o .env (DPAPI, igual ao daemon) e reseta o sync_state.
# Precisa ficar em backend/edge/ para o carregarEnvLocal achar ../.env.local.
$js = @'
import { carregarEnvLocal } from './decifrar-env.mjs';
carregarEnvLocal(import.meta.url);
const pg = await import('pg');
const c = new pg.default.Client(process.env.EDGE_DATABASE_URL);
await c.connect();
const set = (k, v) => c.query(
  'insert into sync_state(chave,valor) values($1,$2) on conflict(chave) do update set valor=$2', [k, v]);
await set('restaurando', '0');
await set('restaurar_solicitado', '1');
await set('restore_cursor', '1970-01-01T00:00:00Z');
await set('pull_cursor', '1970-01-01T00:00:00Z');
await c.query("delete from sync_state where chave in ('pull_cursores','restaurado_em')");
console.log('reset OK -> restaurar_solicitado=1, restaurando=0, cursores zerados');
await c.end();
'@
$tmp = Join-Path $edge '_reset-restore.mjs'
Set-Content $tmp $js -Encoding UTF8
try {
  Push-Location $edge
  & $node _reset-restore.mjs
  if ($LASTEXITCODE -ne 0) { throw "o reset no banco falhou (rc=$LASTEXITCODE)" }
  Pop-Location
} finally {
  Remove-Item $tmp -Force -ErrorAction SilentlyContinue
}

Restart-Service RegemEdgeSync
Write-Host "RegemEdgeSync reiniciado. O daemon vai puxar o restore COMPLETO da nuvem." -ForegroundColor Green
Write-Host "Acompanhe ate 'Restauracao concluida - N linha(s)' em:" -ForegroundColor Green
Write-Host "  Get-Content '$Raiz\logs\RegemEdgeSync.log' -Tail 5 -Wait" -ForegroundColor Cyan
