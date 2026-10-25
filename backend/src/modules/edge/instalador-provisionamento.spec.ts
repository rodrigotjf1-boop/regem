import { spawn, spawnSync } from 'node:child_process';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PROVISIONAMENTO NA NUVEM TENTA DE NOVO QUANDO A CONEXÃO CAI (ERR-304). Na loja, em 25/10/2026, com a internet
// oscilando (o servidor teve "Connect Timeout" com a Cloudflare na mesma madrugada), o POST /provisionamento/instalar
// caiu sem resposta ("Uma conexão que deveria ser mantida ativa foi fechada pelo servidor") e a instalação parou —
// a segunda execução do instalador deu certo. A nuvem reaproveita o servidor da mesma máquina: repetir é seguro.
// Resposta da nuvem (escolher a loja, re-autorizar, senha errada) NÃO se repete e chega inteira a quem chamou.
const INSTALADOR = join(__dirname, '..', '..', '..', 'edge', 'instalar-tudo.ps1');
jest.setTimeout(120_000);

describe('instalador: provisionamento com nova tentativa (ERR-304)', () => {
  const fonte = readFileSync(INSTALADOR, 'utf8');

  it('as duas chamadas do provisionamento passam pela função; ela usa conexão nova e só repete a queda sem resposta', () => {
    expect(fonte.match(/\$r = Provisionar-NaNuvem \("\{0\}\/provisionamento\/instalar" -f \$CloudApi\.TrimEnd\('\/'\)\) \(\$payload \| ConvertTo-Json -Compress\)/g)).toHaveLength(2);
    expect(fonte).not.toMatch(/Invoke-RestMethod -Method Post -Uri \("\{0\}\/provisionamento\/instalar"/);
    const funcao = fonte.slice(fonte.indexOf('function Provisionar-NaNuvem'), fonte.indexOf('# As ultimas linhas nao vazias'));
    expect(funcao).toContain('-DisableKeepAlive');
    expect(funcao).toContain('$comResposta = $null -ne $_.Exception.Response');
    expect(funcao).toMatch(/if \(\$comResposta -or \$t -ge \$Tentativas\) \{ throw \}/);
  });
});

const PS = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
const temPs = spawnSync(PS, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' }).status === 0;
if (!temPs) console.warn(`instalador-provisionamento.spec: sem ${PS} — execução da função PULADA`);
const descreverPs = temPs ? describe : describe.skip;

/** Nuvem falsa: o cenário é o 1º segmento do caminho. "cai1" derruba a 1ª conexão; "sempre" derruba todas. */
async function nuvemFalsa() {
  const pedidos: Record<string, number> = {};
  const srv: Server = createServer((req, res) => {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const cenario = (req.url ?? '').split('/')[1];
      const n = (pedidos[cenario] = (pedidos[cenario] ?? 0) + 1);
      if ((cenario === 'cai1' && n === 1) || cenario === 'sempre') return req.socket.destroy(); // sem resposta
      const json = (status: number, o: unknown) => {
        res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(o));
      };
      if (cenario === 'loja') {
        return json(400, { message: 'Escolha em qual unidade este servidor está sendo instalado.', escolhaUnidade: true, unidades: [{ id: 'u1', nome: 'Centro' }] });
      }
      return json(201, { syncToken: `tok-${cenario}`, unidadeId: 'u1', corpo: JSON.parse(b || '{}') });
    });
  });
  await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
  return { srv, pedidos, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
}

/** Roda o .ps1 ASSÍNCRONO: a nuvem falsa responde neste mesmo processo (um spawnSync travaria o laço). */
function rodarPs(script: string, args: string[]): Promise<{ codigo: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const p = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => (stderr += d));
    const prazo = setTimeout(() => p.kill(), 100_000);
    p.on('close', (codigo) => {
      clearTimeout(prazo);
      resolve({ codigo: codigo ?? -1, stdout, stderr });
    });
  });
}

descreverPs('instalador: provisionamento com nova tentativa (execução real)', () => {
  it('cai na 1ª e passa na 2ª; cai sempre e desiste na 3ª; a recusa da nuvem não se repete e chega inteira', async () => {
    const nuvem = await nuvemFalsa();
    const dir = mkdtempSync(join(tmpdir(), 'regem-prov-'));
    try {
      const script = join(dir, 'roteiro.ps1');
      writeFileSync(
        script,
        [
          'param([string]$Instalador, [string]$Url)',
          "$ErrorActionPreference = 'Stop'",
          '[Console]::OutputEncoding = [Text.Encoding]::UTF8 # a saida vem para o node em UTF-8 (o 5.1 usaria a pagina do console)',
          '$t = $null; $e = $null',
          '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$t, [ref]$e)',
          "foreach ($nome in @('Provisionar-NaNuvem', 'Resposta-DaNuvem')) {",
          '  $f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq $nome }, $true)',
          '  . ([ScriptBlock]::Create($f.Extent.Text))',
          '}',
          '$script:ditos = @()',
          'function Diga($m) { $script:ditos += "$m" }',
          '$corpo = (@{ email = "dono@teste"; fingerprint = "fp-1" } | ConvertTo-Json -Compress)',
          '$r1 = Provisionar-NaNuvem "$Url/cai1/provisionamento/instalar" $corpo 3 0',
          '$sempre = $null',
          'try { $null = Provisionar-NaNuvem "$Url/sempre/provisionamento/instalar" $corpo 3 0 } catch { $sempre = (Resposta-DaNuvem $_) }',
          '$loja = $null',
          'try { $null = Provisionar-NaNuvem "$Url/loja/provisionamento/instalar" $corpo 3 0 } catch { $loja = (Resposta-DaNuvem $_) }',
          '@{',
          '  erros = @($e | ForEach-Object { $_.Message })',
          '  token = $r1.syncToken; fingerprint = $r1.corpo.fingerprint',
          '  sempreStatus = $sempre.Status; sempreMsg = $sempre.Mensagem',
          '  lojaStatus = $loja.Status; lojaEscolha = $loja.Json.escolhaUnidade; lojaMsg = $loja.Mensagem',
          '  ditos = @($script:ditos)',
          '} | ConvertTo-Json -Compress -Depth 4',
        ].join('\r\n'),
      );
      const r = await rodarPs(script, ['-Instalador', INSTALADOR, '-Url', nuvem.url]);
      let saida: any;
      try {
        saida = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!);
      } catch {
        throw new Error(`o PowerShell não devolveu JSON (código ${r.codigo}):\n${r.stdout}\n${r.stderr}`);
      }
      expect(saida.erros).toEqual([]);
      // Caiu na 1ª, passou na 2ª, com o mesmo corpo.
      expect(saida.token).toBe('tok-cai1');
      expect(saida.fingerprint).toBe('fp-1');
      expect(nuvem.pedidos.cai1).toBe(2);
      // Caiu sempre: 3 tentativas e o erro original (sem status HTTP) chega a quem chamou.
      expect(nuvem.pedidos.sempre).toBe(3);
      expect(saida.sempreStatus).toBe(0); // Resposta-DaNuvem: sem resposta HTTP, o status vira 0
      expect(String(saida.sempreMsg)).not.toBe('');
      // A nuvem respondeu (400, escolher a loja): UMA tentativa só, e a resposta inteira chega a quem chamou.
      expect(nuvem.pedidos.loja).toBe(1);
      expect(saida.lojaStatus).toBe(400);
      expect(saida.lojaEscolha).toBe(true);
      expect(saida.lojaMsg).toBe('Escolha em qual unidade este servidor está sendo instalado.');
      // O instalador diz na tela que tentou de novo (1 vez no "cai1", 2 no "sempre").
      expect(saida.ditos.filter((d: string) => d.startsWith('A conexao com a nuvem caiu'))).toHaveLength(3);
    } finally {
      await new Promise((ok) => nuvem.srv.close(ok));
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
