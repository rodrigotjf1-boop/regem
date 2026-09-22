import { generateKeyPairSync } from 'node:crypto';
import { createServer, Server } from 'node:https';
import { AddressInfo } from 'node:net';
import * as forge from 'node-forge';
import { assinarNfe } from '../assinatura';
import { montarNfceXml } from '../nfce-xml.builder';
import { autorizarNfce, lerRetornoAutorizacao } from './autorizacao';

/* eslint-disable @typescript-eslint/no-explicit-any */

// AUTORIZAÇÃO DA NFC-e — leitura das respostas e chamada completa contra uma SEFAZ falsa com
// certificado de cliente obrigatório. Nenhuma SEFAZ real e nenhum certificado real aqui.

const CHAVE = '33260936219750000104650510000000011552821127';

const retorno = (lote: string, prot?: string) =>
  `<retEnviNFe versao="4.00" xmlns="http://www.portalfiscal.inf.br/nfe"><tpAmb>2</tpAmb>` +
  `<verAplic>SVRS</verAplic><cStat>${lote}</cStat><xMotivo>${lote === '104' ? 'Lote processado' : 'Rejeicao no lote'}</xMotivo>` +
  `<cUF>33</cUF><dhRecbto>2026-09-22T10:00:01-03:00</dhRecbto>${prot ?? ''}</retEnviNFe>`;
const prot = (cStat: string, xMotivo: string) =>
  `<protNFe versao="4.00"><infProt><tpAmb>2</tpAmb><verAplic>SVRS</verAplic><chNFe>${CHAVE}</chNFe>` +
  `<dhRecbto>2026-09-22T10:00:01-03:00</dhRecbto>${cStat === '100' || cStat === '120' ? '<nProt>333260000000001</nProt>' : ''}` +
  `<digVal>abc=</digVal><cStat>${cStat}</cStat><xMotivo>${xMotivo}</xMotivo></infProt></protNFe>`;
const NFE = '<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe' + CHAVE + '"></infNFe><Signature/></NFe>';

describe('leitura do retorno da autorização', () => {
  it('104 + 100: AUTORIZADA, com protocolo e o nfeProc (NFe + protNFe)', () => {
    const r: any = lerRetornoAutorizacao(retorno('104', prot('100', 'Autorizado o uso da NF-e')), NFE);
    expect(r.situacao).toBe('autorizada');
    expect(r.protocolo).toBe('333260000000001');
    expect(r.nfeProc).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?><nfeProc versao="4.00" xmlns="http:\/\/www.portalfiscal.inf.br\/nfe"><NFe/);
    expect(r.nfeProc).toContain('<protNFe');
    expect(r.nfeProc.match(/<\?xml/g)).toHaveLength(1); // uma declaração só, no topo
  });

  it('104 + 120 ("autorizado com alerta") também é AUTORIZADA — tratar como erro duplicaria a venda', () => {
    expect(lerRetornoAutorizacao(retorno('104', prot('120', 'Autorizado com alerta')), NFE).situacao).toBe('autorizada');
  });

  it('104 + rejeição da NOTA: rejeitada, com o código e o motivo da nota', () => {
    const r: any = lerRetornoAutorizacao(retorno('104', prot('539', 'Duplicidade de NF-e')), NFE);
    expect(r).toMatchObject({ situacao: 'rejeitada', cStat: '539', nivel: 'nota' });
  });

  it('lote recusado inteiro (ex.: 215 falha de schema): rejeitada no nível do LOTE', () => {
    expect(lerRetornoAutorizacao(retorno('215'), NFE)).toMatchObject({ situacao: 'rejeitada', cStat: '215', nivel: 'lote' });
  });

  it('103 "lote recebido" é PENDENTE — nem autorizada, nem rejeitada', () => {
    const r: any = lerRetornoAutorizacao(retorno('103').replace('</retEnviNFe>', '<infRec><nRec>331000000000001</nRec></infRec></retEnviNFe>'), NFE);
    expect(r).toMatchObject({ situacao: 'pendente', recibo: '331000000000001' });
  });
});

// ── Chamada completa contra a SEFAZ falsa (TLS + certificado de cliente) ─────────────────────
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

describe('autorização contra uma SEFAZ falsa', () => {
  const ac = chaves();
  const AC = { cn: 'AC DE TESTE', privPem: ac.priv };
  const acPem = emitir('AC DE TESTE', ac.pub, AC, true);
  const srv = chaves();
  const srvPem = emitir('localhost', srv.pub, AC, false, [{ type: 2, value: 'localhost' }]);
  const loja = chaves();
  const cert = { chavePrivadaPem: loja.priv, certificadoPem: emitir('BAR DE TESTE LTDA:12345678000195', loja.pub, AC, false) };

  let server: Server;
  let url = '';
  let recebido: { acao: string; corpo: string } | null = null;

  beforeAll(async () => {
    server = createServer({ key: srv.priv, cert: srvPem, ca: [acPem], requestCert: true, rejectUnauthorized: true }, (req, res) => {
      let corpo = '';
      req.on('data', (d) => (corpo += d));
      req.on('end', () => {
        recebido = { acao: /action="([^"]+)"/.exec(String(req.headers['content-type']))?.[1] ?? '', corpo };
        res.writeHead(200, { 'Content-Type': 'application/soap+xml; charset=utf-8' });
        res.end(
          '<soap:Envelope xmlns:soap="http://www.w3.org/2003/05/soap-envelope"><soap:Body>' +
            '<nfeResultMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4">' +
            retorno('104', prot('100', 'Autorizado o uso da NF-e')) +
            '</nfeResultMsg></soap:Body></soap:Envelope>',
        );
      });
    });
    await new Promise<void>((ok) => server.listen(0, '127.0.0.1', () => ok()));
    url = `https://localhost:${(server.address() as AddressInfo).port}/ws/NFeAutorizacao4.asmx`;
  }, 60000);
  afterAll(() => new Promise<void>((ok) => server.close(() => ok())));

  const xmlAssinado = () =>
    assinarNfe(
      montarNfceXml({
        config: {
          crt: 1, ambiente: '2', cnpj: '12345678000195', razaoSocial: 'BAR', ie: '1', uf: 'RJ', codigoUf: 33,
          codigoMunicipio: 3304557, municipio: 'Rio de Janeiro', endereco: 'Rua A', numero: '1', bairro: 'Centro',
        },
        serie: 51, numero: 1, chave: CHAVE, cNF: '15528211', dhEmi: '2026-09-22T10:00:00-03:00',
        itens: [{ codigo: '1', descricao: 'X', ncm: '21069090', quantidade: 1, precoUnitario: 1 }],
        forma: 'dinheiro', qrCode: `https://consultadfe.fazenda.rj.gov.br/consultaNFCe/QRCode?p=${CHAVE}|3|2`,
        urlChave: 'www.fazenda.rj.gov.br/nfce/consulta',
      }),
      cert,
    );

  it('envia um lote SÍNCRONO com UMA nota assinada, na ação certa, e lê a autorização', async () => {
    const r: any = await autorizarNfce({ uf: 'RJ', ambiente: '2', xmlAssinado: xmlAssinado(), cert, ca: [acPem], url });
    expect(r.situacao).toBe('autorizada');
    expect(recebido!.acao).toBe('http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote');
    // indSinc=1 é obrigatório na NFC-e (NT 2025.001 — assíncrona com 1 nota é rejeição 452).
    expect(recebido!.corpo).toMatch(/<enviNFe versao="4.00" xmlns="http:\/\/www.portalfiscal.inf.br\/nfe"><idLote>\d{1,15}<\/idLote><indSinc>1<\/indSinc><NFe /);
    // A NFe vai SEM a declaração <?xml ?> (ela não pode aparecer no meio do envelope).
    expect(recebido!.corpo.match(/<\?xml/g)).toHaveLength(1);
    expect(recebido!.corpo).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
  });

  it('recusa transmitir XML SEM assinatura', async () => {
    const semAssinatura = xmlAssinado().replace(/<Signature[\s\S]*<\/Signature>/, '');
    await expect(
      autorizarNfce({ uf: 'RJ', ambiente: '2', xmlAssinado: semAssinatura, cert, ca: [acPem], url }),
    ).rejects.toThrow(/ASSINADA/);
  });
});
