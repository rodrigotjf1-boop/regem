import { spawnSync } from 'node:child_process';
import { generateKeyPairSync, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as forge from 'node-forge';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CA DA LOJA NO WINDOWS DO SERVIDOR, SEM AS ANTIGAS (ERR-307). Com a 1.30.11 o ícone do servidor seguia dizendo "o
// certificado não é o da loja" com o certificado certo: o gen-cert de antes dava a toda CA o mesmo nome ("Regem Edge
// CA") e a mesma série (01), cada troca de certificado deixava mais uma no Windows do servidor, e ele usava a errada. O
// instalador (modo servidor) agora tira as "Regem Edge CA" antigas antes de pôr a atual — nenhuma outra CA — e confere DE
// VERDADE se o Windows confia no certificado do sistema, avisando o dono se não. O teste usa um cofre PRÓPRIO (do
// usuário, com nome de teste): nada mexe no cofre de raiz desta máquina.
const INSTALADOR = join(__dirname, '..', '..', '..', 'edge', 'instalar-tudo.ps1');
jest.setTimeout(120_000);

describe('instalador: a CA da loja no Windows do servidor (ERR-307) — as peças', () => {
  const fonte = readFileSync(INSTALADOR, 'utf8');
  it('o passo 4 usa o cofre de raiz da máquina, tira as antigas e confere a confiança, avisando o dono', () => {
    const passo = fonte.slice(fonte.indexOf('# ---- 4) confiar o ca.pem NESTA maquina ----'), fonte.indexOf('# ---- 5) health-check ----'));
    expect(passo).toContain("$tiradas = Confiar-CaDaLoja $ca (New-Object Security.Cryptography.X509Certificates.X509Store('Root', 'LocalMachine'))");
    expect(passo).toContain('$semConfianca = Motivo-SemConfianca $certDir');
    expect(passo).toMatch(/if \(\$semConfianca\) \{[\s\S]*Avisar-Dono/);
    expect(passo).not.toContain('Import-Certificate');
    // Só as de MESMO nome "Regem Edge CA..." e outra impressão digital.
    expect(fonte).toContain("$_.Subject -eq $atual.Subject -and $_.Subject -like 'CN=Regem Edge CA*' -and $_.Thumbprint -ne $atual.Thumbprint");
  });
});

function chaves() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return { publica: forge.pki.publicKeyFromPem(publicKey), privada: forge.pki.privateKeyFromPem(privateKey) };
}
function ca(nome: string, serie: string) {
  const k = chaves();
  const c = forge.pki.createCertificate();
  c.publicKey = k.publica;
  c.serialNumber = serie;
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 3650 * 86_400_000);
  c.setSubject([{ name: 'commonName', value: nome }]);
  c.setIssuer([{ name: 'commonName', value: nome }]);
  c.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
  c.sign(k.privada, forge.md.sha256.create());
  return { k, c, pem: forge.pki.certificateToPem(c) };
}
function servidor(emissora: ReturnType<typeof ca>) {
  const k = chaves();
  const c = forge.pki.createCertificate();
  c.publicKey = k.publica;
  c.serialNumber = '2a';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 3650 * 86_400_000);
  c.setSubject([{ name: 'commonName', value: 'regem.local' }]);
  c.setIssuer(emissora.c.subject.attributes);
  c.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }] }]);
  c.sign(emissora.k.privada, forge.md.sha256.create());
  return forge.pki.certificateToPem(c);
}

// Roda de verdade só no Windows (o cofre de certificados é o do Windows); no CI (Linux) é pulado.
(process.platform === 'win32' ? describe : describe.skip)('instalador: a CA da loja no Windows (PowerShell de verdade)', () => {
  it('tira só as "Regem Edge CA" antigas de mesmo nome, põe a atual, e diz quando o Windows não confia', () => {
    const pasta = mkdtempSync(join(tmpdir(), 'regem-ca-loja-'));
    const cofre = `RegemTesteCA${randomUUID().slice(0, 8)}`;
    try {
      const atual = ca('Regem Edge CA', '7f01');
      const antiga = ca('Regem Edge CA', '01'); // como o gen-cert de antes: mesmo nome, outra chave
      const outra = ca('Outra CA', '01');
      writeFileSync(join(pasta, 'ca.pem'), atual.pem);
      writeFileSync(join(pasta, 'server.crt'), servidor(atual));
      writeFileSync(join(pasta, 'antiga.pem'), antiga.pem);
      writeFileSync(join(pasta, 'outra.pem'), outra.pem);
      const roteiro = join(pasta, 'roteiro.ps1');
      writeFileSync(
        roteiro,
        [
          'param([string]$Instalador, [string]$Pasta, [string]$Nome)',
          "$ErrorActionPreference = 'Stop'",
          '$t = $null; $e = $null',
          '$ast = [System.Management.Automation.Language.Parser]::ParseFile($Instalador, [ref]$t, [ref]$e)',
          "foreach ($n in @('Confiar-CaDaLoja', 'Motivo-SemConfianca')) {",
          '  $f = $ast.Find({ param($x) $x -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $x.Name -eq $n }, $true)',
          '  . ([ScriptBlock]::Create($f.Extent.Text))',
          '}',
          '$novo = { New-Object Security.Cryptography.X509Certificates.X509Store($Nome, "CurrentUser") }',
          '$c = & $novo; $c.Open("ReadWrite")',
          '$c.Add((New-Object Security.Cryptography.X509Certificates.X509Certificate2 (Join-Path $Pasta "antiga.pem")))',
          '$c.Add((New-Object Security.Cryptography.X509Certificates.X509Certificate2 (Join-Path $Pasta "outra.pem")))',
          '$c.Close()',
          '$primeira = Confiar-CaDaLoja (Join-Path $Pasta "ca.pem") (& $novo)',
          '$segunda = Confiar-CaDaLoja (Join-Path $Pasta "ca.pem") (& $novo)',
          '$c = & $novo; $c.Open("ReadOnly"); $ficaram = @($c.Certificates | ForEach-Object { $_.Thumbprint }); $c.Close()',
          '$motivo = Motivo-SemConfianca $Pasta',
          '$c = & $novo; $c.Open("ReadWrite"); foreach ($x in @($c.Certificates)) { $c.Remove($x) }; $c.Close()',
          // O cofre do usuário não se apaga pelo Cert:\ — ele mora no registro do usuário.
          "try { Remove-Item -Path (\"HKCU:\\Software\\Microsoft\\SystemCertificates\\\" + $Nome) -Recurse -Force -ErrorAction Stop } catch { }",
          '@{ erros = @($e | ForEach-Object { $_.Message }); primeira = $primeira; segunda = $segunda; ficaram = $ficaram; motivo = $motivo } | ConvertTo-Json -Compress',
        ].join('\r\n'),
      );
      const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', roteiro, '-Instalador', INSTALADOR, '-Pasta', pasta, '-Nome', cofre], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error(`PowerShell saiu ${r.status}: ${r.stderr}`);
      const saida = JSON.parse(r.stdout.trim().split(/\r?\n/).pop()!);
      const impressao = (pem: string) => forge.md.sha1.create().update(forge.asn1.toDer(forge.pki.certificateToAsn1(forge.pki.certificateFromPem(pem))).getBytes()).digest().toHex().toUpperCase();
      expect(saida.erros).toEqual([]);
      expect(saida.primeira).toBe(1); // a antiga de mesmo nome saiu
      expect(saida.segunda).toBe(0); // na segunda vez, nada a tirar
      expect([...saida.ficaram].sort()).toEqual([impressao(atual.pem), impressao(outra.pem)].sort()); // a atual entrou; a de outro nome ficou
      // Esta máquina não confia na CA de teste: o motivo vem, com a raiz que o Windows achou e a da loja.
      expect(saida.motivo).toMatch(/^cadeia: .*(UntrustedRoot|PartialChain)/); // não confia: a raiz não está no cofre
      expect(saida.motivo).toContain(impressao(atual.pem));
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
