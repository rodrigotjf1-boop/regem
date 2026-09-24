import { generateKeyPairSync } from 'node:crypto';
import { createServer as criarHttps, Server } from 'node:https';
import { createServer as criarTcp, Server as ServidorTcp, Socket } from 'node:net';
import { AddressInfo } from 'node:net';
import * as forge from 'node-forge';
import { SefazInalcancavel, chamarSefaz } from './soap';

/* eslint-disable @typescript-eslint/no-explicit-any */

// DUAS COISAS QUE SÓ SE PROVAM NA REDE DE VERDADE (servidores locais, nada da SEFAZ real):
//
//  1. O PRAZO TOTAL do caminho do totem. O `timeout` do Node é de OCIOSIDADE: uma resposta que
//     chega aos pingos o renova a cada pacote e a espera não tem fim. O totem tem o cliente na
//     frente — estourou o prazo, é SILÊNCIO (e silêncio leva à contingência).
//  2. O CERTIFICADO VENCIDO (item E do totem). Reproduzido: a SEFAZ exige certificado de cliente,
//     o nosso está vencido, ela derruba o aperto de mão — e o Node devolve ECONNRESET, que o
//     `chamarSefaz` só pode ler como "rede caída". Por isso a trava tem de ser ANTES (pré-voo da
//     emissão, ERR-099): pela rede, certificado vencido é indistinguível de SEFAZ fora do ar.

function chaves() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    priv: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
const DIA = 86_400_000;
function emitir(
  cn: string, pubPem: string, emissor: { cn: string; privPem: string }, ca: boolean,
  de: Date, ate: Date, alt?: any[],
) {
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(pubPem);
  c.serialNumber = String(Math.floor(Math.random() * 1e8));
  c.validity.notBefore = de;
  c.validity.notAfter = ate;
  c.setSubject([{ name: 'commonName', value: cn }]);
  c.setIssuer([{ name: 'commonName', value: emissor.cn }]);
  const ext: any[] = [{ name: 'basicConstraints', cA: ca }];
  if (alt) ext.push({ name: 'subjectAltName', altNames: alt });
  c.setExtensions(ext);
  c.sign(forge.pki.privateKeyFromPem(emissor.privPem), forge.md.sha256.create());
  return forge.pki.certificateToPem(c);
}

const agora = Date.now();
const ac = chaves();
const AC = { cn: 'AC DE TESTE', privPem: ac.priv };
const acPem = emitir('AC DE TESTE', ac.pub, AC, true, new Date(agora - 10 * DIA), new Date(agora + 10 * DIA));
const srv = chaves();
const srvPem = emitir('localhost', srv.pub, AC, false, new Date(agora - DIA), new Date(agora + DIA), [
  { type: 2, value: 'localhost' },
  { type: 7, ip: '127.0.0.1' },
]);
const loja = chaves();
const CN_LOJA = 'BAR DE TESTE LTDA:12345678000195';
const certValido = {
  chavePrivadaPem: loja.priv,
  certificadoPem: emitir(CN_LOJA, loja.pub, AC, false, new Date(agora - DIA), new Date(agora + 60 * DIA)),
};
const certVencido = {
  chavePrivadaPem: loja.priv,
  certificadoPem: emitir(CN_LOJA, loja.pub, AC, false, new Date(agora - 400 * DIA), new Date(agora - 2 * DIA)),
};

const RET_107 =
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">' +
  '<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>' +
  '<cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo></retConsStatServ>' +
  '</nfeResultMsg></soap:Body></soap:Envelope>';

const chamar = (url: string, cert: any, extra: Record<string, unknown> = {}) =>
  chamarSefaz({ url, servico: 'NFeStatusServico4', corpoXml: '<consStatServ/>', cert, ca: [acPem], ...extra });

describe('prazo TOTAL da chamada à SEFAZ (caminho do totem)', () => {
  let mudo: ServidorTcp;
  const conexoes: Socket[] = [];
  let pingos: Server;
  const timers: NodeJS.Timeout[] = [];

  beforeAll(async () => {
    // Aceita a conexão e nunca responde nada — nem o aperto de mão TLS.
    mudo = criarTcp((s) => conexoes.push(s));
    await new Promise<void>((ok) => mudo.listen(0, '127.0.0.1', () => ok()));
    // Responde o cabeçalho e depois PINGA um byte a cada 100 ms, para sempre: o tempo de
    // ociosidade nunca estoura.
    pingos = criarHttps(
      { key: srv.priv, cert: srvPem, ca: [acPem], requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        req.resume();
        res.writeHead(200, { 'Content-Type': 'application/soap+xml' });
        res.write('<soap:Envelope');
        timers.push(setInterval(() => res.write(' '), 100));
      },
    );
    await new Promise<void>((ok) => pingos.listen(0, '127.0.0.1', () => ok()));
  });

  afterAll(async () => {
    timers.forEach(clearInterval);
    conexoes.forEach((s) => s.destroy());
    await new Promise<void>((ok) => mudo.close(() => ok()));
    (pingos as any).closeAllConnections?.();
    await new Promise<void>((ok) => pingos.close(() => ok()));
  });

  it('servidor mudo: estourou o prazo, é SILÊNCIO (SefazInalcancavel) — no prazo, não em 30 s', async () => {
    const url = `https://127.0.0.1:${(mudo.address() as AddressInfo).port}/ws`;
    const t0 = Date.now();
    const erro: any = await chamar(url, certValido, { prazoTotalMs: 400 }).catch((e) => e);
    expect(erro).toBeInstanceOf(SefazInalcancavel);
    expect(erro.codigo).toBe('ETIMEDOUT');
    expect(Date.now() - t0).toBeLessThan(2_000);
  });

  it('resposta AOS PINGOS: só o prazo total para a espera — e ela vira silêncio, não "recusa"', async () => {
    const url = `https://localhost:${(pingos.address() as AddressInfo).port}/ws`;
    const t0 = Date.now();
    // Ociosidade de 30 s (a de sempre): sozinha, nunca estouraria com um byte a cada 100 ms.
    const erro: any = await chamar(url, certValido, { timeoutMs: 30_000, prazoTotalMs: 700 }).catch((e) => e);
    expect(erro).toBeInstanceOf(SefazInalcancavel);
    expect(Date.now() - t0).toBeLessThan(3_000);
  });
});

describe('certificado da loja VENCIDO diante de uma SEFAZ que exige certificado de cliente', () => {
  let sefaz: Server;
  let url = '';
  let atendidas = 0;

  beforeAll(async () => {
    sefaz = criarHttps(
      { key: srv.priv, cert: srvPem, ca: [acPem], requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        atendidas++;
        req.resume();
        req.on('end', () => {
          res.writeHead(200, { 'Content-Type': 'application/soap+xml' });
          res.end(RET_107);
        });
      },
    );
    await new Promise<void>((ok) => sefaz.listen(0, '127.0.0.1', () => ok()));
    url = `https://localhost:${(sefaz.address() as AddressInfo).port}/ws`;
  });

  afterAll(() => new Promise<void>((ok) => sefaz.close(() => ok())));

  it('com o certificado válido, a conversa acontece (controle)', async () => {
    await expect(chamar(url, certValido)).resolves.toContain('<cStat>107</cStat>');
  });

  it('VENCIDO: a conexão cai no aperto de mão e o erro chega como "rede" — indistinguível de SEFAZ fora', async () => {
    const antes = atendidas;
    const erro: any = await chamar(url, certVencido).catch((e) => e);
    // É ESTE o defeito que o pré-voo passa a barrar: sem a trava, a nota ficava "pendente", a
    // venda entrava em contingência e o QR saía assinado por um certificado vencido.
    expect(erro).toBeInstanceOf(SefazInalcancavel);
    expect(String(erro.codigo)).toMatch(/ECONNRESET|EPROTO|ERR_SSL/);
    expect(atendidas).toBe(antes); // nada chegou a ser processado do outro lado
  });
});
