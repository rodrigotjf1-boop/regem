import { execFile, execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as https from 'node:https';
import * as net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as forge from 'node-forge';

// O ÍCONE DO SERVIDOR FALA TLS 1.2 (ERR-303). Compilado pelo csc sem a marca de versão do .NET, o HttpWebRequest
// oferecia só SSL3/TLS 1.0; o sistema da loja (Node, TLS 1.2 no mínimo) recusava, e o ícone dizia "o certificado do
// sistema deste servidor não é o da loja (reinstale o servidor)" com os 5 serviços de pé (loja, 25/10/2026). O teste de
// fim a fim do #726 falava HTTP — por isso nunca viu.
//
// Aqui o .cs é compilado como o package.mjs compila e chamado com --diagnostico contra um servidor HTTPS do Node com um
// certificado que esta máquina NÃO confia (o teste não mexe nos certificados do Windows): com o TLS 1.2, a conversa
// chega ao certificado (TrustFailure → "certificado"); sem ele, cai antes ("unsupported protocol" no servidor).
const EDGE = join(__dirname, '..', '..', '..', 'edge');
jest.setTimeout(120_000);

function certificado() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(publicKey);
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  const nome = [{ name: 'commonName', value: 'localhost' }];
  c.setSubject(nome);
  c.setIssuer(nome);
  c.setExtensions([{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] }]);
  c.sign(forge.pki.privateKeyFromPem(privateKey), forge.md.sha256.create());
  return { key: privateKey, cert: forge.pki.certificateToPem(c) };
}

describe('ícone do servidor: conversa com o sistema da loja por TLS 1.2 (ERR-303)', () => {
  it('o fonte força o TLS 1.2 e separa "certificado" de "conexão segura" (só o primeiro manda reinstalar)', () => {
    const cs = readFileSync(join(EDGE, 'bandeja', 'RegemServidor.cs'), 'utf8');
    expect(cs).toMatch(/static Api\(\)\s*\{\s*ServicePointManager\.SecurityProtocol = SecurityProtocolType\.Tls12;/);
    expect(cs).toMatch(/if \(we\.Status == WebExceptionStatus\.TrustFailure\)\s*throw new Exception\("o certificado/);
    expect(cs).toMatch(/if \(we\.Status == WebExceptionStatus\.SecureChannelFailure\)\s*throw new Exception\("o \\u00edcone n\\u00e3o conseguiu abrir a conex\\u00e3o segura/);
    expect([...cs].filter((c) => c.charCodeAt(0) > 127)).toEqual([]); // o csc lê na página de código do Windows
  });

  // Compila de verdade só no Windows (o .NET Framework 4.8 vem no sistema); no CI (Linux) é pulado.
  const csc = process.env.SystemRoot ? join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : '';
  (csc && existsSync(csc) ? it : it.skip)('compilado como o pacote, chega ao certificado do servidor HTTPS (não cai no protocolo)', async () => {
    const pasta = mkdtempSync(join(tmpdir(), 'regem-icone-tls-'));
    const errosTls: string[] = [];
    const srv = https.createServer(certificado(), (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{}');
    });
    srv.on('tlsClientError', (e: any) => errosTls.push(String(e?.code ?? e?.message ?? e)));
    try {
      const exe = join(pasta, 'RegemServidor.exe');
      execFileSync(csc, ['-nologo', '-optimize+', '-target:winexe', `-out:${exe}`, `-win32icon:${join(EDGE, 'regem.ico')}`,
        '-r:System.Web.Extensions.dll', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', '-r:System.ServiceProcess.dll',
        join(EDGE, 'bandeja', 'RegemServidor.cs')], { stdio: 'pipe' });
      await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
      const porta = (srv.address() as net.AddressInfo).port;
      writeFileSync(join(pasta, 'bandeja.key'), 'chave-de-teste');
      const diag = join(pasta, 'diag.txt');
      // O .exe é de janela (winexe): o diagnóstico grava o que o ícone mostraria e sai com 2 no erro. ASSÍNCRONO: o
      // servidor HTTPS roda neste mesmo processo — um execFileSync travaria o laço e o ícone diria "não responde".
      await new Promise<void>((ok) =>
        execFile(exe, ['--raiz', pasta, '--api', `https://localhost:${porta}`, '--diagnostico', diag], { timeout: 60_000 }, () => ok()),
      );
      const saida = readFileSync(diag, 'utf8').replace(/^\uFEFF/, '');
      expect(saida).toContain('erro=o certificado do sistema deste servidor não é o da loja');
      expect(errosTls).not.toContain('ERR_SSL_UNSUPPORTED_PROTOCOL');
    } finally {
      srv.closeAllConnections?.();
      await new Promise((ok) => srv.close(ok));
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
