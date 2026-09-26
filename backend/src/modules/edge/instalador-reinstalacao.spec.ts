import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Reinstalação do servidor da loja na MESMA máquina (edge/instalar-tudo.ps1): o que identifica o
// servidor para as pessoas e os aparelhos fica — a chave de sessão (quem estava logado continua)
// e o webhook do WhatsApp; o certificado é do gen-cert (gen-cert.spec.ts). O .exe passa -Limpar
// SEMPRE, e o -Limpar apaga o .env.local: a leitura tem de vir ANTES. A do OTP_WEBHOOK_URL vinha
// depois e nunca achava (ERR-111).
const INSTALADOR = join(__dirname, '..', '..', '..', 'edge', 'instalar-tudo.ps1');

jest.setTimeout(60_000);

describe('instalador: reinstalação na mesma máquina herda a configuração', () => {
  const fonte = readFileSync(INSTALADOR, 'utf8');

  it('lê a configuração anterior ANTES do -Limpar apagar o .env.local, e só usa depois', () => {
    const leitura = fonte.indexOf('$envHerdado = Ler-EnvLocal $envAntigo');
    const apaga = fonte.indexOf('Remove-Item $envAntigo');
    expect(leitura).toBeGreaterThan(-1);
    expect(apaga).toBeGreaterThan(leitura);
    for (const uso of ['$jwt = $envHerdado.JWT_SECRET', '$OtpWebhookUrl = $envHerdado.OTP_WEBHOOK_URL']) {
      expect(fonte.indexOf(uso)).toBeGreaterThan(apaga);
    }
  });

  it('sem certificado a instalação para em vez de terminar "instalada" com o HTTPS quebrado', () => {
    expect(fonte).toMatch(/\$saidaCert = & \$node "edge\\gen-cert\.mjs" \$ip\s*\n\s*\$rcCert = \$LASTEXITCODE/);
    expect(fonte).toMatch(/if \(\$rcCert -ne 0\) \{ throw /);
  });

  it('Ler-EnvLocal decifra o que é desta máquina e descarta o que não abre', () => {
    const ps = process.platform === 'win32' ? 'powershell.exe' : 'pwsh';
    const tem = spawnSync(ps, ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'], { encoding: 'utf8' });
    if (tem.status !== 0) return console.warn(`instalador-reinstalacao.spec: sem ${ps} — teste do Ler-EnvLocal PULADO`);

    const dir = mkdtempSync(join(tmpdir(), 'regem-env-'));
    try {
      const script = join(dir, 'teste.ps1');
      // Extrai a funcao do instalador pelo AST (o script inteiro nao pode rodar aqui) e a chama
      // num .env.local de mentira. Onde ha DPAPI (Windows), o JWT vai cifrado como na loja.
      writeFileSync(
        script,
        [
          'param([string]$Instalador, [string]$Arquivo)',
          "$ErrorActionPreference = 'Stop'",
          '$t = $null; $e = $null',
          '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$t, [ref]$e)',
          'if ($e.Count) { throw ("instalador com erro de sintaxe: " + $e[0].Message) }',
          "$f = $ast.Find({ param($n) $n -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Ler-EnvLocal' }, $true)",
          "if (-not $f) { throw 'Ler-EnvLocal nao encontrada' }",
          '. ([ScriptBlock]::Create($f.Extent.Text))',
          '$dpapi = $false',
          "$jwt = 'JWT_SECRET=segredo-em-texto-puro-123456'",
          'try {',
          '  Add-Type -AssemblyName System.Security',
          "  $b = [Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('segredo-cifrado-da-sessao-123456'), $null, 'LocalMachine')",
          "  $jwt = 'JWT_SECRET=enc:' + [Convert]::ToBase64String($b)",
          '  $dpapi = $true',
          '} catch { }',
          "$linhas = @('# Gerado automaticamente', $jwt, 'OTP_WEBHOOK_URL=https://n8n.exemplo/webhook/regem-status', 'SYNC_TOKEN=enc:AAAAbm9vcGU=', 'VAZIO=', 'lixo sem igual')",
          'Set-Content -Path $Arquivo -Value $linhas -Encoding ascii',
          "$r = @{ dpapi = $dpapi; valores = (Ler-EnvLocal $Arquivo); inexistente = (Ler-EnvLocal (Join-Path $Arquivo 'nao-existe')).Count }",
          '$r | ConvertTo-Json -Compress -Depth 4',
        ].join('\r\n'),
        'ascii',
      );
      const r = spawnSync(
        ps,
        ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Instalador', INSTALADOR, '-Arquivo', join(dir, '.env.local')],
        { encoding: 'utf8' },
      );
      if (r.status !== 0) throw new Error(`PowerShell saiu com ${r.status}: ${r.stderr}`);
      const saida = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!);

      expect(saida.valores.OTP_WEBHOOK_URL).toBe('https://n8n.exemplo/webhook/regem-status');
      expect(saida.valores.JWT_SECRET).toBe(saida.dpapi ? 'segredo-cifrado-da-sessao-123456' : 'segredo-em-texto-puro-123456');
      // Blob que não abre nesta máquina não vira segredo (quebraria o app com um valor ilegível).
      expect(saida.valores).not.toHaveProperty('SYNC_TOKEN');
      expect(saida.valores.VAZIO).toBe('');
      expect(Object.keys(saida.valores).sort()).toEqual(['JWT_SECRET', 'OTP_WEBHOOK_URL', 'VAZIO']);
      expect(saida.inexistente).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
