import { createHash, verify as verificarRsa } from 'node:crypto';
import * as forge from 'node-forge';
import { ALG, assinarNfe, assinaturaValida } from './assinatura';
import { montarNfceXml, NfceItem } from './nfce-xml.builder';

// ASSINATURA DA NFC-e, conferida por DOIS caminhos independentes.
//
// 1) o verificador da própria xml-crypto;
// 2) uma reconstrução SEM a biblioteca da forma canônica (C14N) que a SEFAZ calcula — para o
//    XML que o NOSSO builder gera: o xmlns herdado de <NFe> vai para o <infNFe>, os atributos
//    ficam em ordem (Id antes de versao) e o &quot; do texto vira aspa literal.
//
// Se a biblioteca canonizasse diferente da SEFAZ, (1) passaria e (2) falharia — exatamente o
// erro que só apareceria como rejeição 297 em produção. Nenhum certificado real entra aqui.

const CHAVE = '33260936219750000104650500000000011552821127';

function certDeTeste() {
  const k = forge.pki.rsa.generateKeyPair(1024);
  const c = forge.pki.createCertificate();
  c.publicKey = k.publicKey;
  c.serialNumber = '01';
  c.validity.notBefore = new Date(Date.now() - 86_400_000);
  c.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  c.setSubject([{ name: 'commonName', value: 'BAR DE TESTE LTDA:12345678000195' }]);
  c.setIssuer([{ name: 'commonName', value: 'AC DE TESTE' }]);
  c.sign(k.privateKey, forge.md.sha256.create());
  return {
    chavePrivadaPem: forge.pki.privateKeyToPem(k.privateKey),
    certificadoPem: forge.pki.certificateToPem(c),
    certDerB64: forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(c)).getBytes()),
  };
}

const config = {
  crt: 1, ambiente: '2', cnpj: '12345678000195', razaoSocial: 'BAR DE TESTE LTDA', ie: '123',
  uf: 'RJ', codigoUf: 33, codigoMunicipio: 3304557, municipio: 'Rio de Janeiro',
  endereco: 'Rua A', numero: '10', bairro: 'Centro',
};
const item = (o: Partial<NfceItem> = {}): NfceItem => ({
  codigo: '1', descricao: 'X-Burguer', ncm: '21069090', quantidade: 1, precoUnitario: 20, ...o,
});
const montar = (itens: NfceItem[]) =>
  montarNfceXml({
    config, serie: 50, numero: 1, chave: CHAVE, cNF: '15528211',
    dhEmi: '2026-09-22T10:00:00-03:00', itens, forma: 'pix',
    qrCode: 'https://sefaz.rj/qr?p=' + CHAVE + '|2|2|1|ABC', urlChave: 'www.fazenda.rj.gov.br/nfce/consulta',
  });

// ── Caminho 2: C14N reconstruída SEM a biblioteca, só para o XML do nosso builder ──────────
function c14nInfNFeIndependente(xml: string): string {
  let t = xml.slice(xml.indexOf('<infNFe '), xml.indexOf('</infNFe>') + '</infNFe>'.length);
  const abre = t.match(/^<infNFe versao="([^"]+)" Id="([^"]+)">/);
  if (!abre) throw new Error('abertura do infNFe fora do esperado');
  t = t.replace(
    abre[0],
    `<infNFe xmlns="http://www.portalfiscal.inf.br/nfe" Id="${abre[2]}" versao="${abre[1]}">`,
  );
  return t.replace(/&quot;/g, '"'); // C14N não escapa aspas em nó de texto
}

function c14nSignedInfoIndependente(xmlAssinado: string): string {
  const si = xmlAssinado.match(/<SignedInfo>[\s\S]*?<\/SignedInfo>/)![0];
  return si
    .replace('<SignedInfo>', '<SignedInfo xmlns="http://www.w3.org/2000/09/xmldsig#">')
    .replace(/<([A-Za-z]+)((?:\s+[^\s=/>]+="[^"]*")*)\s*\/>/g, '<$1$2></$1>'); // C14N expande vazios
}

function conferirIndependente(xmlOriginal: string, xmlAssinado: string, certPem: string) {
  const digestEsperado = createHash('sha1').update(c14nInfNFeIndependente(xmlOriginal), 'utf8').digest('base64');
  const digest = xmlAssinado.match(/<DigestValue>([^<]+)<\/DigestValue>/)![1];
  const sigValue = xmlAssinado.match(/<SignatureValue>([^<]+)<\/SignatureValue>/)![1];
  const assinaturaConfere = verificarRsa(
    'RSA-SHA1',
    Buffer.from(c14nSignedInfoIndependente(xmlAssinado), 'utf8'),
    certPem,
    Buffer.from(sigValue, 'base64'),
  );
  return { digestConfere: digest === digestEsperado, assinaturaConfere };
}

describe('assinatura XML-DSig da NFC-e', () => {
  const cert = certDeTeste();

  it('assina e a própria biblioteca confere', () => {
    const assinado = assinarNfe(montar([item()]), cert);
    expect(assinaturaValida(assinado)).toBe(true);
  });

  it('um SEGUNDO caminho, sem a biblioteca, chega ao mesmo digest e confere a assinatura', () => {
    const original = montar([item()]);
    const r = conferirIndependente(original, assinarNfe(original, cert), cert.certificadoPem);
    expect(r).toEqual({ digestConfere: true, assinaturaConfere: true });
  });

  it.each([
    ['aspas', 'X-Burguer "Especial" da Casa'],
    ['e comercial', 'Batata & Cheddar'],
    ['menor e maior', 'Combo <2 pessoas> 1/2'],
    ['acentos', 'Pão de Açúcar com Maçã — Coração'],
    ['apóstrofo', "Pizza d'Oro"],
  ])('nome de produto com %s: os dois caminhos concordam', (_rotulo, descricao) => {
    const original = montar([item({ descricao })]);
    const assinado = assinarNfe(original, cert);
    expect(assinaturaValida(assinado)).toBe(true);
    expect(conferirIndependente(original, assinado, cert.certificadoPem)).toEqual({
      digestConfere: true,
      assinaturaConfere: true,
    });
  });

  it('alterar UM valor depois de assinado invalida a assinatura', () => {
    const assinado = assinarNfe(montar([item({ precoUnitario: 20 })]), cert);
    const adulterado = assinado.replace('<vProd>20.00</vProd>', '<vProd>2.00</vProd>');
    expect(adulterado).not.toBe(assinado);
    expect(assinaturaValida(adulterado)).toBe(false);
  });

  it('segue o padrão da SEFAZ: algoritmos, referência e só o certificado do assinante', () => {
    const assinado = assinarNfe(montar([item()]), cert);
    expect(assinado).toContain(`<CanonicalizationMethod Algorithm="${ALG.C14N}"`);
    expect(assinado).toContain(`<SignatureMethod Algorithm="${ALG.RSA_SHA1}"`);
    expect(assinado).toContain(`<Transform Algorithm="${ALG.ENVELOPED}"`);
    expect(assinado).toContain(`<DigestMethod Algorithm="${ALG.SHA1}"`);
    expect(assinado).toContain(`<Reference URI="#NFe${CHAVE}">`);
    expect(assinado.match(/<X509Certificate>/g)).toHaveLength(1);
    expect(assinado).toContain(`<X509Certificate>${cert.certDerB64}</X509Certificate>`);
    expect(assinado).toContain('<Signature xmlns="http://www.w3.org/2000/09/xmldsig#">');
  });

  it('a ordem dentro de <NFe> é infNFe → infNFeSupl → Signature', () => {
    const a = assinarNfe(montar([item()]), cert);
    const i = a.indexOf('</infNFe>');
    const s = a.indexOf('<infNFeSupl>');
    const g = a.indexOf('<Signature');
    expect(i).toBeGreaterThan(0);
    expect(s).toBeGreaterThan(i);
    expect(g).toBeGreaterThan(s);
    expect(a.trimEnd().endsWith('</Signature></NFe>')).toBe(true);
  });

  it('o XML assinado continua numa linha só (sem quebra no certificado nem na assinatura)', () => {
    expect(assinarNfe(montar([item()]), cert)).not.toMatch(/[\r\n\t]/);
  });

  it('recusa assinar duas vezes, ou XML sem a chave de acesso no Id', () => {
    const assinado = assinarNfe(montar([item()]), cert);
    expect(() => assinarNfe(assinado, cert)).toThrow(/já está assinado/);
    expect(() => assinarNfe('<NFe><infNFe Id="NFe123"></infNFe></NFe>', cert)).toThrow(/44 dígitos/);
  });
});
