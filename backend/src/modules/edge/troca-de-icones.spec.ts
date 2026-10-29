import { ChildProcess, execFileSync, spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// OS ÍCONES DO SERVIDOR NA ATUALIZAÇÃO (.zip) — P3 do plano do dono de 25/10/2026 ("menos .exe"). Antes o .zip copiava
// só os arquivos soltos de edge\, e o edge\bandeja (RegemServidor.exe, RegemEstacao.exe) só mudava reinstalando — a
// correção do ícone do servidor (TLS 1.2, ERR-303) teria de esperar um .exe. Agora, com a saúde confirmada, a
// atualização troca os ícones: o .exe ABERTO é renomeado (o Windows deixa renomear, não apagar) e o novo entra no
// lugar; o ícone do servidor percebe a troca, abre o novo e se fecha. Este teste roda a troca de verdade (PowerShell)
// e, no Windows, o ícone compilado de verdade, aberto durante a troca.
const EDGE = join(__dirname, '..', '..', '..', 'edge');
const COMUM = join(EDGE, 'atualizacao-comum.ps1');
jest.setTimeout(180_000);

const sha = (arq: string) => createHash('sha256').update(readFileSync(arq)).digest('hex');
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('troca dos ícones na atualização — as peças amarradas', () => {
  it('a atualização troca os ícones DEPOIS da saúde confirmada, sem desfazer nada se falhar', () => {
    const atualizar = readFileSync(join(EDGE, 'atualizar.ps1'), 'utf8');
    const sucesso = atualizar.indexOf('# Sucesso.');
    const saude = atualizar.indexOf('$motivo = Checar-Saude $porta $script:versaoNova 150');
    const troca = atualizar.indexOf("Trocar-Icones (Join-Path $novo 'edge\\bandeja') (Join-Path $Raiz 'edge\\bandeja')");
    expect(saude).toBeGreaterThan(-1);
    expect(sucesso).toBeGreaterThan(saude);
    expect(troca).toBeGreaterThan(sucesso);
    expect(troca).toBeLessThan(atualizar.indexOf('Apagar-Pasta $stage', sucesso)); // antes de apagar a versão montada
    expect(atualizar.slice(troca - 200, troca + 300)).toMatch(/try \{[\s\S]*\} catch \{ Diga "\(aviso\) nao troquei os icones do servidor/);
    // O pacote tem de levar os dois ícones (senão a troca não acontece).
    expect(readFileSync(join(EDGE, 'publicar.ps1'), 'utf8')).toContain("'edge/bandeja/RegemServidor.exe', 'edge/bandeja/RegemEstacao.exe'");
    // Os scripts da atualização são lidos pelo PowerShell 5.1 sem BOM: nada fora do ASCII.
    for (const f of [atualizar, readFileSync(COMUM, 'utf8')]) expect([...f].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
  });

  // ERR-323: os ícones saem do csc com versão 0.0.0.0 e o Inno, sem `ignoreversion`, não troca um .exe de mesma
  // versão — a reinstalação pelo .exe mantinha o ícone da PRIMEIRA instalação (a loja piloto seguiu com o de 24/10).
  it('o instalador (.exe) troca os arquivos do sistema mesmo com a mesma versão (os ícones)', () => {
    const iss = readFileSync(join(EDGE, 'regem-edge.iss'), 'utf8');
    const linha = iss.split(/\r?\n/).find((l) => l.startsWith('Source: "..\\..\\regem-edge-dist\\*"'));
    expect(linha).toBeDefined();
    expect(linha).toMatch(/Flags: [^;]*\bignoreversion\b/);
  });

  it('o ícone do servidor vigia o próprio arquivo e o novo espera a trava do antigo sair', () => {
    const cs = readFileSync(join(EDGE, 'bandeja', 'RegemServidor.cs'), 'utf8');
    expect(cs).toMatch(/Troca\.Iniciar\(Application\.ExecutablePath, args\);\s+Api api = new Api\(\);/); // antes de tudo
    expect(cs).toMatch(/vigiaDaTroca\.Tick \+= delegate \{ if \(Troca\.Trocado\(\)\) Reabrir\(\); \};/);
    expect(cs).toMatch(/if \(!substituir\) return 0;\s+try \{ if \(!m\.WaitOne\(30000\)\) return 0; \} catch \(AbandonedMutexException\) \{ \}/);
    expect([...cs].filter((c) => c.charCodeAt(0) > 127)).toEqual([]);
  });
});

const PS = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const temPs = spawnSync(PS, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
if (!temPs) console.warn(`troca-de-icones.spec: sem ${PS} — execução PULADA`);

/** Roda o Trocar-Icones de verdade (extraído do atualizacao-comum.ps1). ASSÍNCRONO: um ícone pode estar rodando. */
function trocar(de: string, para: string): Promise<number> {
  const pasta = mkdtempSync(join(tmpdir(), 'regem-troca-ps-'));
  const roteiro = join(pasta, 'roteiro.ps1');
  writeFileSync(
    roteiro,
    [
      'param([string]$Comum, [string]$De, [string]$Para)',
      "$ErrorActionPreference = 'Stop'",
      '$t = $null; $e = $null',
      '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Comum, [ref]$t, [ref]$e)',
      "$f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Trocar-Icones' }, $true)",
      '. ([ScriptBlock]::Create($f.Extent.Text))',
      'Trocar-Icones $De $Para',
    ].join('\r\n'),
  );
  return new Promise((resolve, reject) => {
    const p = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', roteiro, '-Comum', COMUM, '-De', de, '-Para', para], { stdio: ['ignore', 'pipe', 'pipe'] });
    let saida = '';
    let erro = '';
    p.stdout.on('data', (d) => (saida += d));
    p.stderr.on('data', (d) => (erro += d));
    p.on('close', (codigo) => {
      rmSync(pasta, { recursive: true, force: true });
      if (codigo !== 0) return reject(new Error(`PowerShell saiu ${codigo}: ${erro}`));
      resolve(Number(saida.trim().split(/\r?\n/).pop()));
    });
  });
}

(temPs ? describe : describe.skip)('Trocar-Icones (PowerShell de verdade)', () => {
  it('copia o que falta, não mexe no igual, troca o diferente e não deixa a cópia antiga quando ninguém a usa', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'regem-troca-'));
    try {
      const de = join(raiz, 'pacote');
      const para = join(raiz, 'instalado');
      mkdirSync(de);
      writeFileSync(join(de, 'RegemServidor.exe'), 'versao 1');
      writeFileSync(join(de, 'leia-me.txt'), 'não é ícone');
      expect(await trocar(de, para)).toBe(1);
      expect(readFileSync(join(para, 'RegemServidor.exe'), 'utf8')).toBe('versao 1');
      expect(existsSync(join(para, 'leia-me.txt'))).toBe(false); // só os .exe
      expect(await trocar(de, para)).toBe(0); // igual: não troca
      writeFileSync(join(de, 'RegemServidor.exe'), 'versao 2');
      expect(await trocar(de, para)).toBe(1);
      expect(readFileSync(join(para, 'RegemServidor.exe'), 'utf8')).toBe('versao 2');
      expect(readdirSync(para)).toEqual(['RegemServidor.exe']); // a antiga, sem uso, já saiu
      expect(await trocar(join(raiz, 'nao-existe'), para)).toBe(0); // pacote sem a pasta: nada
    } finally {
      rmSync(raiz, { recursive: true, force: true });
    }
  });

  // No Windows: o ícone compilado DE VERDADE, aberto durante a troca (o arquivo em uso só pode ser renomeado).
  const csc = process.env.SystemRoot ? join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : '';
  (csc && existsSync(csc) ? it : it.skip)('com o ícone ABERTO: a troca renomeia o antigo, o ícone percebe, abre o novo e sai', async () => {
    const raiz = mkdtempSync(join(tmpdir(), 'regem-troca-icone-'));
    let antigo: ChildProcess | null = null;
    try {
      const compilar = (saida: string) =>
        execFileSync(csc, ['-nologo', '-optimize+', '-target:winexe', `-out:${saida}`, `-win32icon:${join(EDGE, 'regem.ico')}`,
          '-r:System.Web.Extensions.dll', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', '-r:System.ServiceProcess.dll',
          join(EDGE, 'bandeja', 'RegemServidor.cs')], { stdio: 'pipe' });
      const instalado = join(raiz, 'instalado');
      const pacote = join(raiz, 'pacote');
      mkdirSync(instalado);
      mkdirSync(pacote);
      compilar(join(instalado, 'RegemServidor.exe'));
      await espera(1100); // o novo nasce com outra data
      compilar(join(pacote, 'RegemServidor.exe'));
      expect(sha(join(pacote, 'RegemServidor.exe'))).not.toBe(sha(join(instalado, 'RegemServidor.exe')));
      const marcador = join(raiz, 'abriu-o-novo.txt');
      // O ícone antigo, aberto (modo de teste sem janela: confere o arquivo como o ícone de verdade).
      let codigoAntigo: number | null = null;
      antigo = spawn(join(instalado, 'RegemServidor.exe'), ['--raiz', raiz, '--teste-troca', marcador], { stdio: 'ignore' });
      antigo.on('exit', (c) => (codigoAntigo = c));
      await espera(1500);
      expect(codigoAntigo).toBeNull(); // segue aberto, esperando
      // A atualização troca.
      expect(await trocar(pacote, instalado)).toBe(1);
      expect(sha(join(instalado, 'RegemServidor.exe'))).toBe(sha(join(pacote, 'RegemServidor.exe')));
      // O antigo percebe, abre o novo (que marca que abriu) e sai.
      const fim = Date.now() + 20_000;
      while (Date.now() < fim && !(existsSync(marcador) && codigoAntigo !== null)) await espera(200);
      expect(existsSync(marcador) ? readFileSync(marcador, 'utf8') : '(o novo não abriu)').toBe('ok');
      expect(codigoAntigo).toBe(0);
      // Sem ninguém usando a cópia antiga, a próxima chamada a apaga.
      expect(await trocar(pacote, instalado)).toBe(0);
      expect(readdirSync(instalado)).toEqual(['RegemServidor.exe']);
    } finally {
      try { antigo?.kill(); } catch { /* já saiu */ }
      await espera(300);
      rmSync(raiz, { recursive: true, force: true });
    }
  });
});
