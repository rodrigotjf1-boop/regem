import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O STATUS DO BACKUP QUE O SERVIDOR DA LOJA MANDA À NUVEM (ERR-305). O backup.ps1 gravava backups\ultimo-backup.json
// com [Text.Encoding]::UTF8 — COM BOM — e o JSON.parse do daemon falhava no primeiro caractere: a nuvem via "backup
// falhou" em toda loja desde o #546, com o backup em dia. Agora o backup.ps1 grava sem BOM e a leitura
// (edge/marcador-backup.mjs, a que o daemon usa) aceita os dois — o script antigo segue instalado até a atualização.
const EDGE = join(__dirname, '..', '..', '..', 'edge');
const MODULO = join(EDGE, 'marcador-backup.mjs');

/** Roda a função de verdade (ESM, com import) num Node à parte: o jest roda em CommonJS. */
function ler(dirBk: string, agoraMs?: number): any {
  const pasta = mkdtempSync(join(tmpdir(), 'regem-marcador-run-'));
  try {
    const runner = join(pasta, 'run.mjs');
    writeFileSync(
      runner,
      `import { lerStatusDoBackup } from ${JSON.stringify(pathToFileURL(MODULO).href)};\n` +
        `console.log(JSON.stringify(lerStatusDoBackup(process.argv[2], process.argv[3] ? Number(process.argv[3]) : undefined)));\n`,
    );
    const r = spawnSync(process.execPath, [runner, dirBk, ...(agoraMs ? [String(agoraMs)] : [])], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`o módulo falhou: ${r.stderr}`);
    return JSON.parse(r.stdout.trim());
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

describe('status do backup no sinal de saúde (ERR-305)', () => {
  let raiz: string;
  beforeEach(() => {
    raiz = mkdtempSync(join(tmpdir(), 'regem-marcador-'));
  });
  afterEach(() => rmSync(raiz, { recursive: true, force: true }));

  const agora = Date.parse('2026-10-25T12:00:00.000Z');
  const marcador = { ok: true, em: '2026-10-25T06:00:00.000Z', duracao_s: 12, arquivo: 'db-20261025-030000.dump.enc', bytes: 52428800, erro: null };

  it('o arquivo COM BOM (o backup.ps1 antigo, ainda instalado nas lojas) é lido como backup em dia', () => {
    writeFileSync(join(raiz, 'ultimo-backup.json'), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(marcador))]));
    expect(ler(raiz, agora)).toEqual({ ok: true, em: marcador.em, horas: 6, mb: 50, erro: null });
  });

  it('sem BOM, a falha gravada e o JSON estragado (que vira "não consegui ler", sem lançar)', () => {
    writeFileSync(join(raiz, 'ultimo-backup.json'), JSON.stringify(marcador));
    expect(ler(raiz, agora).ok).toBe(true);
    writeFileSync(join(raiz, 'ultimo-backup.json'), JSON.stringify({ ok: false, em: marcador.em, erro: 'pg_dump saiu com 1' }));
    expect(ler(raiz, agora)).toMatchObject({ ok: false, erro: 'pg_dump saiu com 1' });
    writeFileSync(join(raiz, 'ultimo-backup.json'), '{ ok: ');
    expect(ler(raiz, agora)).toMatchObject({ ok: false, erro: expect.stringMatching(/^não consegui ler: /) });
  });

  it('sem o marcador (instalação antiga): o dump mais novo da pasta; sem dump e sem pasta, o motivo', () => {
    writeFileSync(join(raiz, 'db-20261024-030000.dump.enc'), Buffer.alloc(1024));
    writeFileSync(join(raiz, 'db-20261025-030000.dump.enc'), Buffer.alloc(2048));
    utimesSync(join(raiz, 'db-20261024-030000.dump.enc'), new Date(agora - 30 * 3600e3), new Date(agora - 30 * 3600e3));
    utimesSync(join(raiz, 'db-20261025-030000.dump.enc'), new Date(agora - 6 * 3600e3), new Date(agora - 6 * 3600e3));
    expect(ler(raiz, agora)).toMatchObject({ ok: true, horas: 6, erro: null });
    const vazia = join(raiz, 'vazia');
    mkdirSync(vazia);
    expect(ler(vazia, agora)).toMatchObject({ ok: false, erro: 'nenhum backup encontrado' });
    expect(ler(join(raiz, 'nao-existe'), agora)).toMatchObject({ ok: false, erro: 'pasta de backups inexistente' });
  });

  it('o daemon usa esta leitura (nada de JSON.parse do marcador escrito à mão)', () => {
    const daemon = readFileSync(join(EDGE, 'sync-daemon.mjs'), 'utf8');
    expect(daemon).toMatch(/from '\.\/marcador-backup\.mjs'/);
    expect(daemon).toContain("saude.backup = lerStatusDoBackup(join(dirname(process.cwd()), 'backups'));");
    expect(daemon).not.toMatch(/ultimo-backup\.json/);
  });

  // O backup.ps1 de verdade grava o marcador SEM BOM — e a leitura entende. Roda no PowerShell 5.1 (Windows) e no 7 (CI).
  const PS = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
  const temPs = spawnSync(PS, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
  (temPs ? it : it.skip)('o Gravar-Resultado do backup.ps1 grava sem BOM, e a leitura dá "backup em dia"', () => {
    const roteiro = join(raiz, 'roteiro.ps1');
    writeFileSync(
      roteiro,
      [
        'param([string]$Script, [string]$Pasta)',
        "$ErrorActionPreference = 'Stop'",
        '$t = $null; $e = $null',
        '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Script, [ref]$t, [ref]$e)',
        "foreach ($nome in @('Reg', 'Gravar-Resultado')) {",
        '  $f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $nome }, $true)',
        '  . ([ScriptBlock]::Create($f.Extent.Text))',
        '}',
        "$logFile = Join-Path $Pasta 'backup.log'",
        "$marcador = Join-Path $Pasta 'ultimo-backup.json'",
        '$inicio = Get-Date',
        "Gravar-Resultado $true $null 'db-teste.dump.enc' 52428800",
      ].join('\r\n'),
    );
    const r = spawnSync(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', roteiro, '-Script', join(EDGE, 'backup.ps1'), '-Pasta', raiz], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`PowerShell saiu com ${r.status}: ${r.stderr}`);
    const bruto = readFileSync(join(raiz, 'ultimo-backup.json'));
    expect([...bruto.subarray(0, 3)]).not.toEqual([0xef, 0xbb, 0xbf]);
    expect(JSON.parse(bruto.toString('utf8'))).toMatchObject({ ok: true, arquivo: 'db-teste.dump.enc', bytes: 52428800 });
    expect(ler(raiz)).toMatchObject({ ok: true, mb: 50, erro: null });
  });
});
