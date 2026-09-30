import { spawn, spawnSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O INSTALADOR NA LOJA DE 29/09 (ERR-122, ERR-123, ERR-124).
//
// Numa máquina com instalação antiga, o instalador passou 14 min tentando subir os dados dela com
// a credencial que a nuvem já recusava, leu o resultado como "código de saída  " (vazio) e só
// então pediu o código da trava — que vale 10 min e venceu. A recusa da nuvem apareceu como
// "(400) Solicitação Incorreta". Estes testes rodam as funções do instalador de verdade (extraídas
// pelo AST: o script inteiro não pode rodar aqui) contra uma nuvem falsa.
const EDGE = join(__dirname, '..', '..', '..', 'edge');
const INSTALADOR = join(EDGE, 'instalar-tudo.ps1');

jest.setTimeout(120_000);

describe('scripts do edge: o código de saída de Start-Process -PassThru existe (LIC-142)', () => {
  // No Windows PowerShell 5.1, o ExitCode de um Start-Process -PassThru vem VAZIO se ninguém
  // segurou o Handle antes do processo sair. O atualizacao-comum.ps1 já sabia disso; o instalador
  // não, e o resultado do envio antes da reinstalação nunca foi lido (ERR-122).
  const scripts = readdirSync(EDGE).filter((f) => f.endsWith('.ps1'));

  it('todo processo lançado com -PassThru guarda o Handle logo em seguida', () => {
    const faltando: string[] = [];
    let vistos = 0;
    for (const f of scripts) {
      const fonte = readFileSync(join(EDGE, f), 'utf8');
      for (const m of fonte.matchAll(/\$(\w+)\s*=\s*Start-Process\b/g)) {
        // O comando (com as continuações `) cabe nos 400 primeiros caracteres; o Handle vem logo depois.
        const janela = fonte.slice(m.index!, m.index! + 700);
        if (!/-PassThru\b/i.test(janela.slice(0, 400))) continue;
        vistos++;
        const linha = fonte.slice(0, m.index!).split('\n').length;
        if (!new RegExp(`\\$null\\s*=\\s*\\$${m[1]}\\.Handle`).test(janela)) faltando.push(`${f}:${linha}`);
      }
    }
    expect(vistos).toBeGreaterThanOrEqual(2); // instalador + atualização: a busca enxerga os dois
    expect(faltando).toEqual([]);
  });

  it('o envio antes da reinstalação trata "a nuvem recusou" (4) e o código que não veio', () => {
    const fonte = readFileSync(INSTALADOR, 'utf8');
    expect(fonte).toContain('$codigoDescarga = Rodar-Descarregar');
    expect(fonte).toMatch(/if \(\$null -eq \$codigoDescarga\)/);
    expect(fonte).toMatch(/elseif \(\$codigoDescarga -eq 0\) \{ \$descarregou = \$true \}/);
    expect(fonte).toMatch(/elseif \(\$codigoDescarga -eq 4\)/);
  });
});

// ---------------------------------------------------------------- execução real das funções

const PS = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const temPs = spawnSync(PS, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
if (!temPs) console.warn(`instalador-reautorizacao.spec: sem ${PS} — execução das funções PULADA`);
const descreverPs = temPs ? describe : describe.skip;

const NENHUM = {
  message: 'Nenhum código conferido para este computador nas últimas 2 horas. Peça um novo código.',
  error: 'Bad Request',
  statusCode: 400,
};
const EXPIRADO = { message: 'Código expirado (vale 10 minutos). Peça um novo código.', error: 'Bad Request', statusCode: 400 };
const INVALIDO = { message: 'Código inválido. Use o código do e-mail mais recente.', error: 'Unauthorized', statusCode: 401 };

type Pedido = { cenario: string; rota: string; codigo: string | null };

/** Nuvem falsa das rotas da trava. O cenário vem no 1º segmento do caminho (/a/..., /b/...). */
async function nuvemFalsa() {
  const pedidos: Pedido[] = [];
  const srv: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const [, cenario, ...resto] = (req.url ?? '').split('/');
      const rota = '/' + resto.join('/');
      let corpo: any = {};
      try {
        corpo = JSON.parse(b || '{}');
      } catch {
        /* corpo não-JSON */
      }
      pedidos.push({ cenario, rota, codigo: corpo.codigo ?? null });
      const [status, resp] = responder(cenario, rota, corpo);
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(resp));
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  return { srv, pedidos, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
}

function responder(cenario: string, rota: string, corpo: any): [number, any] {
  if (rota === '/provisionamento/reautorizar/solicitar') return [201, { metodo: 'email', destino: 'do***@teste.regem' }];
  if (rota === '/provisionamento/reautorizar/confirmar') {
    if (!corpo.codigo) return cenario === 'a' ? [201, { syncToken: 'tok-a', unidadeId: 'u1' }] : [400, NENHUM];
    if (corpo.codigo === '111111' || corpo.codigo === '333333') return [400, EXPIRADO];
    if (corpo.codigo === '000000') return [401, INVALIDO];
    return [201, { syncToken: `tok-${cenario}`, unidadeId: 'u1' }];
  }
  return [404, { message: 'rota desconhecida' }];
}

/** Roda um .ps1 ASSÍNCRONO (a nuvem falsa responde neste mesmo processo). */
function rodarPs(script: string, args: string[]): Promise<{ codigo: number; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    p.stdout.on('data', () => undefined);
    p.stderr.on('data', (d) => (stderr += d));
    const prazo = setTimeout(() => p.kill(), 100_000);
    p.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve({ codigo: codigo ?? -1, stderr });
    });
  });
}

descreverPs('instalador: código da trava e envio antes da reinstalação (execução real)', () => {
  let dir: string;
  let resultado: any;
  let pedidos: Pedido[];

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'regem-instalador-'));
    // Daemon falso: sai com o código pedido (ou dorme, para o prazo).
    writeFileSync(
      join(dir, 'daemon-falso.mjs'),
      "const s = process.env.SAIDA_FALSA; if (s === 'dorme') setTimeout(() => {}, 20000); else process.exit(Number(s));",
    );
    const script = join(dir, 'teste.ps1');
    writeFileSync(
      script,
      [
        'param([string]$Instalador, [string]$Cloud, [string]$Node, [string]$Dir)',
        "$ErrorActionPreference = 'Stop'",
        '$t = $null; $e = $null',
        '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$t, [ref]$e)',
        'if ($e.Count) { throw ("instalador com erro de sintaxe: " + $e[0].Message) }',
        "foreach ($nome in @('Resposta-DaNuvem', 'Ultimas-Linhas', 'Rodar-Descarregar', 'Reautorizar-Edge')) {",
        '  $f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $nome }, $true)',
        '  if (-not $f) { throw "$nome nao encontrada" }',
        '  . ([ScriptBlock]::Create($f.Extent.Text))',
        '}',
        '$global:ditos = New-Object System.Collections.ArrayList',
        'function Diga($m) { [void]$global:ditos.Add([string]$m) }',
        '$global:respostas = New-Object System.Collections.Queue',
        'function Read-Host($p) { if ($global:respostas.Count -eq 0) { throw "Read-Host inesperado: $p" }; return $global:respostas.Dequeue() }',
        "$payload = @{ email = 'dono@teste.regem'; senha = 'x'; fingerprint = 'fp-nova' }",
        "$info = [pscustomobject]@{ reauthRequired = $true; metodos = @('email'); metodoPreferido = 'email' }",
        '$saida = @{}',
        'function Cenario($nome, [string[]]$respostas) {',
        '  $global:ditos.Clear(); $global:respostas.Clear()',
        '  foreach ($x in $respostas) { $global:respostas.Enqueue($x) }',
        '  $r = @{ token = $null; erro = $null }',
        '  try { $r.token = (Reautorizar-Edge -CloudApi ("{0}/{1}" -f $Cloud, $nome) -Payload $payload -Info $info).syncToken }',
        '  catch { $r.erro = $_.Exception.Message }',
        '  $r.ditos = @($global:ditos); $r.sobrou = $global:respostas.Count',
        '  return $r',
        '}',
        "$saida.a = Cenario 'a' @()",
        "$saida.b = Cenario 'b' @('111111', 'S', '222222')",
        "$saida.c = Cenario 'c' @('333333', 'N')",
        "$saida.d = Cenario 'd' @('000000', '123456')",
        '$daemon = Join-Path $Dir "daemon-falso.mjs"',
        '$descarga = @{}',
        "foreach ($s in @('0', '3', '4')) {",
        '  $env:SAIDA_FALSA = $s',
        '  $descarga[$s] = Rodar-Descarregar $Node $daemon $Dir (Join-Path $Dir "o.log") (Join-Path $Dir "e.log") 30000',
        '}',
        "$env:SAIDA_FALSA = 'dorme'",
        "try { $null = Rodar-Descarregar $Node $daemon $Dir (Join-Path $Dir 'o.log') (Join-Path $Dir 'e.log') 1500; $descarga.prazo = 'terminou' } catch { $descarga.prazo = $_.Exception.Message }",
        '$saida.descarga = $descarga',
        '[IO.File]::WriteAllText((Join-Path $Dir "resultado.json"), ($saida | ConvertTo-Json -Compress -Depth 6), (New-Object System.Text.UTF8Encoding($false)))',
      ].join('\r\n'),
      'ascii',
    );
    const nuvem = await nuvemFalsa();
    try {
      const r = await rodarPs(script, ['-Instalador', INSTALADOR, '-Cloud', nuvem.url, '-Node', process.execPath, '-Dir', dir]);
      if (r.codigo !== 0) throw new Error(`PowerShell saiu com ${r.codigo}: ${r.stderr}`);
      resultado = JSON.parse(readFileSync(join(dir, 'resultado.json'), 'utf8'));
      pedidos = nuvem.pedidos;
    } finally {
      nuvem.srv.close();
    }
  });

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  const rotasDo = (cenario: string) =>
    pedidos.filter((p) => p.cenario === cenario).map((p) => `${p.rota.split('/').pop()}:${p.codigo ?? '-'}`);

  it('código já conferido no assistente: move sem pedir o código de novo', () => {
    expect(resultado.a.token).toBe('tok-a');
    expect(rotasDo('a')).toEqual(['confirmar:-']);
    expect(resultado.a.sobrou).toBe(0);
  });

  it('código vencido: mostra a frase da nuvem e oferece um código novo em vez de abortar', () => {
    expect(resultado.b.erro).toBeNull();
    expect(resultado.b.token).toBe('tok-b');
    expect(rotasDo('b')).toEqual(['confirmar:-', 'solicitar:-', 'confirmar:111111', 'solicitar:-', 'confirmar:222222']);
    // A frase da nuvem chega inteira (acentos inclusive) — antes era "(400) Solicitação Incorreta".
    expect(resultado.b.ditos).toContain(EXPIRADO.message);
  });

  it('sem código novo, o erro final diz o motivo da nuvem', () => {
    expect(resultado.c.token).toBeNull();
    expect(resultado.c.erro).toBe(`Re-autorizacao falhou: ${EXPIRADO.message}`);
  });

  it('código errado: a frase da nuvem e nova tentativa com o mesmo código pedido', () => {
    expect(resultado.d.token).toBe('tok-d');
    expect(rotasDo('d')).toEqual(['confirmar:-', 'solicitar:-', 'confirmar:000000', 'confirmar:123456']);
    expect(resultado.d.ditos).toContain(`${INVALIDO.message} Tente de novo.`);
  });

  it('o envio antes da reinstalação devolve o código de saída de verdade (0, 3, 4) e respeita o prazo', () => {
    expect(resultado.descarga['0']).toBe(0);
    expect(resultado.descarga['3']).toBe(3);
    expect(resultado.descarga['4']).toBe(4);
    expect(resultado.descarga.prazo).toMatch(/tempo esgotado/);
  });
});
