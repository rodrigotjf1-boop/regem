import { execFile, execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

// O CERTIFICADO CONFERIDO PELA CA DESTA INSTALAÇÃO (ERR-307). Com a 1.30.11, o ícone seguia dizendo "o certificado não
// é o da loja": o certificado estava certo (cobre localhost, assinado pela CA da loja — conferido pela rede em
// 27/10/2026), mas o Windows do servidor guarda as "Regem Edge CA" de certificados anteriores — mesmo nome, mesma série
// 01 — e o .NET usava a errada. Agora vale o Windows confiar OU o certificado ter sido assinado pela CA do arquivo
// edge\certs\ca.pem desta instalação, na validade e com o nome pedido. O teste não mexe no cofre do Windows: a CA de
// teste não está nele, então só o arquivo pode fazer o ícone aceitar.
type Par = { key: string; cert: string; caPem: string };
function chaves() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  });
  return { publica: forge.pki.publicKeyFromPem(publicKey), privada: forge.pki.privateKeyFromPem(privateKey), privadaPem: privateKey };
}
/** Uma CA como a do gen-cert ANTIGO: "Regem Edge CA", série 01 — toda CA da loja tinha esse nome e esse número. */
function caDaLoja() {
  const k = chaves();
  const c = forge.pki.createCertificate();
  c.publicKey = k.publica;
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 3650 * 86_400_000);
  const nome = [{ name: 'commonName', value: 'Regem Edge CA' }];
  c.setSubject(nome);
  c.setIssuer(nome);
  c.setExtensions([{ name: 'basicConstraints', cA: true }, { name: 'keyUsage', keyCertSign: true, cRLSign: true }]);
  c.sign(k.privada, forge.md.sha256.create());
  return { k, c, pem: forge.pki.certificateToPem(c) };
}
function doServidor(ca: ReturnType<typeof caDaLoja>, o: { nomes?: any[]; vencido?: boolean } = {}): Par {
  const k = chaves();
  const c = forge.pki.createCertificate();
  c.publicKey = k.publica;
  c.serialNumber = '02';
  c.validity.notBefore = new Date(Date.now() - (o.vencido ? 10 : 1) * 86_400_000);
  c.validity.notAfter = new Date(Date.now() + (o.vencido ? -86_400_000 : 3650 * 86_400_000));
  c.setSubject([{ name: 'commonName', value: 'regem.local' }]);
  c.setIssuer(ca.c.subject.attributes);
  c.setExtensions([
    { name: 'basicConstraints', cA: false },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
    { name: 'extKeyUsage', serverAuth: true },
    { name: 'subjectAltName', altNames: o.nomes ?? [{ type: 2, value: 'regem.local' }, { type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }] },
  ]);
  c.sign(ca.k.privada, forge.md.sha256.create());
  return { key: k.privadaPem, cert: forge.pki.certificateToPem(c), caPem: ca.pem };
}

const cscCa = process.env.SystemRoot ? join(process.env.SystemRoot, 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe') : '';
(cscCa && existsSync(cscCa) ? describe : describe.skip)('ícone do servidor: o certificado conferido pela CA da instalação (ERR-307)', () => {
  let pasta: string;
  let exe: string;
  beforeAll(() => {
    pasta = mkdtempSync(join(tmpdir(), 'regem-icone-ca-'));
    exe = join(pasta, 'RegemServidor.exe');
    execFileSync(cscCa, ['-nologo', '-optimize+', '-target:winexe', `-out:${exe}`, `-win32icon:${join(EDGE, 'regem.ico')}`,
      '-r:System.Web.Extensions.dll', '-r:System.Windows.Forms.dll', '-r:System.Drawing.dll', '-r:System.ServiceProcess.dll',
      join(EDGE, 'bandeja', 'RegemServidor.cs')], { stdio: 'pipe' });
  });
  afterAll(() => rmSync(pasta, { recursive: true, force: true }));

  /** Sobe um HTTPS com `par`, põe `caNoArquivo` em <raiz>\edge\certs\ca.pem e roda o diagnóstico do ícone. */
  async function diagnostico(par: Par, caNoArquivo: string | null): Promise<string> {
    const raiz = mkdtempSync(join(pasta, 'raiz-'));
    writeFileSync(join(raiz, 'bandeja.key'), 'chave-de-teste');
    if (caNoArquivo) {
      mkdirSync(join(raiz, 'edge', 'certs'), { recursive: true });
      writeFileSync(join(raiz, 'edge', 'certs', 'ca.pem'), caNoArquivo);
    }
    const srv = https.createServer({ key: par.key, cert: par.cert }, (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ servidor: { versao: '1.30.12', loja: 'Loja Centro', nuvem: { linha: 'nuvem sincronizada' } }, resumo: {}, aparelhos: [] }));
    });
    try {
      await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', () => ok()));
      const porta = (srv.address() as net.AddressInfo).port;
      const diag = join(raiz, 'diag.txt');
      await new Promise<void>((ok) => execFile(exe, ['--raiz', raiz, '--api', `https://localhost:${porta}`, '--diagnostico', diag], { timeout: 60_000 }, () => ok()));
      return readFileSync(diag, 'utf8').replace(/^\uFEFF/, '');
    } finally {
      srv.closeAllConnections?.();
      await new Promise((ok) => srv.close(ok));
    }
  }

  it('assinado pela CA do arquivo ca.pem: o ícone lê o estado (o Windows não confia nessa CA)', async () => {
    const ca = caDaLoja();
    const saida = await diagnostico(doServidor(ca), ca.pem);
    expect(saida).not.toMatch(/^erro=/);
    expect(saida).toContain('servidor=1.30.12|Loja Centro|nuvem sincronizada');
  });

  it('outra CA de MESMO nome e MESMA série 01 no arquivo (o caso do servidor da loja): recusa', async () => {
    const certa = caDaLoja();
    const outra = caDaLoja(); // "Regem Edge CA", série 01 — só a chave é outra
    expect(await diagnostico(doServidor(certa), outra.pem)).toContain('erro=o certificado do sistema deste servidor não é o da loja');
  });

  it('sem o nome pedido (localhost) ou vencido: recusa, mesmo assinado pela CA do arquivo; sem o arquivo, vale só o Windows', async () => {
    const ca = caDaLoja();
    const semLocalhost = doServidor(ca, { nomes: [{ type: 2, value: 'regem.local' }] });
    expect(await diagnostico(semLocalhost, ca.pem)).toMatch(/^erro=o certificado/);
    expect(await diagnostico(doServidor(ca, { vencido: true }), ca.pem)).toMatch(/^erro=o certificado/);
    expect(await diagnostico(doServidor(ca), null)).toMatch(/^erro=o certificado/);
  });

  it('o fonte usa a conferência na chamada e confere a assinatura com a chave da CA (sha256WithRSA)', () => {
    const cs = readFileSync(join(EDGE, 'bandeja', 'RegemServidor.cs'), 'utf8');
    expect(cs).toContain('req.ServerCertificateValidationCallback = ConferirCertificado;');
    expect(cs).toMatch(/if \(erros == SslPolicyErrors\.None\) return true;/);
    expect(cs).toMatch(/RemoteCertificateNameMismatch \| SslPolicyErrors\.RemoteCertificateNotAvailable\)\) != 0\) return false;/);
    expect(cs).toContain('rsa.VerifyData(tbs, sig, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1)');
  });
});
