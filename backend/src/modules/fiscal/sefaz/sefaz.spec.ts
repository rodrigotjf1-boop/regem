import { X509Certificate, generateKeyPairSync } from 'node:crypto';
import { createServer, Server } from 'node:https';
import { AddressInfo } from 'node:net';
import * as forge from 'node-forge';
import { ICP_BRASIL_RAIZ_V10_PEM, ICP_BRASIL_RAIZ_V10_SHA256, autoridadesSefaz } from './icp-brasil';
import { SefazInalcancavel, SefazRecusouChamada, extrairResultado } from './soap';
import { consultarStatusServico } from './status-servico';
import { UfSemAutorizador, urlServicoNfce } from './webservices';

/* eslint-disable @typescript-eslint/no-explicit-any */

// CONVERSA COM A SEFAZ — contra uma "SVRS" falsa, local, com TLS e certificado de cliente
// obrigatório, igual à de verdade. Nenhum certificado real e nenhuma SEFAZ real aqui.

describe('raiz da ICP-Brasil embutida', () => {
  it('é a v10 conferida — trocar o conteúdo reprova este teste', () => {
    const c = new X509Certificate(ICP_BRASIL_RAIZ_V10_PEM);
    expect(c.fingerprint256).toBe(ICP_BRASIL_RAIZ_V10_SHA256);
    expect(c.subject).toContain('Autoridade Certificadora Raiz Brasileira v10');
    expect(c.ca).toBe(true);
  });

  it('entra SOMADA às raízes do Node, não no lugar delas', () => {
    const cas = autoridadesSefaz();
    expect(cas.length).toBeGreaterThan(100);
    expect(cas).toContain(ICP_BRASIL_RAIZ_V10_PEM);
  });
});

describe('endereços da NFC-e', () => {
  it('RJ vai para a SVRS, nos endereços do portal oficial', () => {
    expect(urlServicoNfce('RJ', '2', 'NFeStatusServico4')).toBe(
      'https://nfce-homologacao.svrs.rs.gov.br/ws/NfeStatusServico/NfeStatusServico4.asmx',
    );
    expect(urlServicoNfce('rj', '1', 'NFeAutorizacao4')).toBe(
      'https://nfce.svrs.rs.gov.br/ws/NfeAutorizacao/NFeAutorizacao4.asmx',
    );
  });

  it('UF sem autorizador confirmado é RECUSADA — nada de chute', () => {
    expect(() => urlServicoNfce('SP', '2', 'NFeStatusServico4')).toThrow(UfSemAutorizador);
    expect(() => urlServicoNfce('', '2', 'NFeStatusServico4')).toThrow(/não está habilitada/);
  });
});

// ── Infraestrutura de teste: uma AC, o certificado do "servidor da SEFAZ" e o da "loja" ─────
function chaves() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return {
    priv: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
    pub: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}
function emitir(cn: string, pubPem: string, emissor: { cn: string; privPem: string }, ca: boolean, alt?: any[]) {
  const c = forge.pki.createCertificate();
  c.publicKey = forge.pki.publicKeyFromPem(pubPem);
  c.serialNumber = String(Math.floor(Math.random() * 1e8));
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 86_400_000);
  c.setSubject([{ name: 'commonName', value: cn }]);
  c.setIssuer([{ name: 'commonName', value: emissor.cn }]);
  const ext: any[] = [{ name: 'basicConstraints', cA: ca }];
  if (alt) ext.push({ name: 'subjectAltName', altNames: alt });
  c.setExtensions(ext);
  c.sign(forge.pki.privateKeyFromPem(emissor.privPem), forge.md.sha256.create());
  return forge.pki.certificateToPem(c);
}

const RET_107 =
  '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
  '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4">' +
  '<retConsStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>' +
  '<verAplic>SVRS202609</verAplic><cStat>107</cStat><xMotivo>Servico em Operacao</xMotivo>' +
  '<cUF>33</cUF><dhRecbto>2026-09-22T10:00:00-03:00</dhRecbto><tMed>1</tMed></retConsStatServ>' +
  '</nfeResultMsg></soap:Body></soap:Envelope>';

describe('consulta de status contra uma SEFAZ falsa com certificado de cliente obrigatório', () => {
  const ac = chaves();
  const AC = { cn: 'AC DE TESTE', privPem: ac.priv };
  const acPem = emitir('AC DE TESTE', ac.pub, AC, true);
  const srv = chaves();
  const srvPem = emitir('localhost', srv.pub, AC, false, [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
  ]);
  const loja = chaves();
  const lojaPem = emitir('BAR DE TESTE LTDA:12345678000195', loja.pub, AC, false);
  const cert = { chavePrivadaPem: loja.priv, certificadoPem: lojaPem };

  let server: Server;
  let url = '';
  let resposta = RET_107;
  let status = 200;
  let ultimo: { acao: string; corpo: string; clienteCN: string } | null = null;

  beforeAll(async () => {
    server = createServer(
      { key: srv.priv, cert: srvPem, ca: [acPem], requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        let corpo = '';
        req.on('data', (d) => (corpo += d));
        req.on('end', () => {
          const acao = /action="([^"]+)"/.exec(String(req.headers['content-type'] ?? ''))?.[1] ?? '';
          const clienteCN = (req.socket as any).getPeerCertificate()?.subject?.CN ?? '';
          ultimo = { acao, corpo, clienteCN };
          res.writeHead(status, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
          res.end(resposta);
        });
      },
    );
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
    url = `https://localhost:${(server.address() as AddressInfo).port}/ws/NfeStatusServico4.asmx`;
  }, 60000);

  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  beforeEach(() => {
    resposta = RET_107;
    status = 200;
    ultimo = null;
  });

  it('responde 107 e lê os campos do retorno', async () => {
    const r = await consultarStatusServico({ uf: 'RJ', codigoUf: 33, ambiente: '2', cert, ca: [acPem], url });
    expect(r).toMatchObject({
      cStat: '107', emOperacao: true, xMotivo: 'Servico em Operacao', cUF: '33', tpAmb: '2', tMedSegundos: 1,
    });
  });

  it('manda a AÇÃO SOAP certa, o pedido certo e APRESENTA o certificado da loja', async () => {
    await consultarStatusServico({ uf: 'RJ', codigoUf: 33, ambiente: '2', cert, ca: [acPem], url });
    expect(ultimo!.acao).toBe('http://www.portalfiscal.inf.br/nfe/wsdl/NFeStatusServico4/nfeStatusServicoNF');
    expect(ultimo!.corpo).toContain('<soap12:Envelope xmlns:soap12="http://www.w3.org/2003/05/soap-envelope">');
    expect(ultimo!.corpo).toContain(
      '<consStatServ versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb><cUF>33</cUF><xServ>STATUS</xServ></consStatServ>',
    );
    expect(ultimo!.clienteCN).toBe('BAR DE TESTE LTDA:12345678000195');
  });

  it('SEFAZ paralisada (108) chega como tal — não como erro de rede', async () => {
    resposta = RET_107.replace('<cStat>107</cStat>', '<cStat>108</cStat>').replace(
      'Servico em Operacao',
      'Servico Paralisado Momentaneamente',
    );
    const r = await consultarStatusServico({ uf: 'RJ', codigoUf: 33, ambiente: '2', cert, ca: [acPem], url });
    expect(r.emOperacao).toBe(false);
    expect(r.cStat).toBe('108');
  });

  it('SOAP Fault vira "a SEFAZ recusou a chamada", com o motivo', async () => {
    status = 500;
    resposta =
      '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body><soap:Fault>' +
      '<soap:Reason><soap:Text xml:lang="pt">Unable to handle request without a valid action parameter.</soap:Text>' +
      '</soap:Reason></soap:Fault></soap:Body></soap:Envelope>';
    await expect(
      consultarStatusServico({ uf: 'RJ', codigoUf: 33, ambiente: '2', cert, ca: [acPem], url }),
    ).rejects.toThrow(SefazRecusouChamada);
  });

  it('servidor que NÃO prova ser a SEFAZ é RECUSADO — a verificação nunca é desligada', async () => {
    // Sem a AC de teste, o servidor não tem como provar quem é (como um impostor no caminho).
    await expect(
      consultarStatusServico({ uf: 'RJ', codigoUf: 33, ambiente: '2', cert, ca: autoridadesSefaz(), url }),
    ).rejects.toThrow(/não pôde ser verificado/);
    expect(ultimo).toBeNull(); // nada chegou a ser enviado
  });

  it('SEFAZ fora do ar vira "não respondeu" (candidata a nova tentativa), não "recusou"', async () => {
    await expect(
      consultarStatusServico({
        uf: 'RJ', codigoUf: 33, ambiente: '2', cert, ca: [acPem], url: 'https://127.0.0.1:1/ws',
      }),
    ).rejects.toThrow(SefazInalcancavel);
  });
});

describe('leitura do retorno', () => {
  it('pega o elemento de dentro do nfeResultMsg, com qualquer prefixo de SOAP', () => {
    const r = extrairResultado(RET_107.replace(/soap:/g, 's:').replace(/xmlns:soap=/, 'xmlns:s='));
    expect(r).toContain('<retConsStatServ');
    expect(r).toContain('<cStat>107</cStat>');
  });
});
