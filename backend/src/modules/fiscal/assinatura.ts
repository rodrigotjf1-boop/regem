import { SignedXml } from 'xml-crypto';

// ASSINATURA DIGITAL DA NF-e / NFC-e (XML-DSig), com o certificado A1 da loja.
//
// O padrão é fixo pelo Manual de Orientação do Contribuinte — qualquer desvio é a rejeição
// 297 ("Assinatura difere do calculado") ou 298 ("Assinatura difere do padrão do sistema"):
//   • assinatura ENVELOPED, filha de <NFe>, depois de <infNFe> e de <infNFeSupl>;
//   • assina SÓ o <infNFe>, referenciado por URI="#NFe<chave>" (o atributo Id dele);
//   • transforms: enveloped-signature + C14N 1.0 inclusiva (sem comentários);
//   • SignatureMethod RSA-SHA1 e DigestMethod SHA-1 (o leiaute 4.00 ainda usa SHA-1);
//   • KeyInfo com UM X509Certificate — o do assinante, sem a cadeia.
//
// Por que biblioteca e não canonicalização à mão: a C14N reescreve o texto antes do hash
// (ordena atributos, herda o xmlns do pai, desfaz o &quot; do texto). Uma aspa no nome de um
// produto já muda o que é assinado — e o erro não aparece aqui, só na SEFAZ. O teste confere
// esta assinatura por um SEGUNDO caminho, independente da biblioteca.

export const ALG = {
  C14N: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
  ENVELOPED: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
  RSA_SHA1: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
  SHA1: 'http://www.w3.org/2000/09/xmldsig#sha1',
} as const;

export interface ChaveDeAssinatura {
  chavePrivadaPem: string;
  certificadoPem: string;
}

/** Assina a NF-e/NFC-e. Recebe o XML completo (<NFe> com <infNFe> e, na NFC-e, <infNFeSupl>). */
export function assinarNfe(xml: string, cert: ChaveDeAssinatura): string {
  if (/<Signature[\s>]/.test(xml)) throw new Error('O XML já está assinado.');
  if (!/<infNFe\b[^>]*\bId="NFe\d{44}"/.test(xml))
    throw new Error('XML sem <infNFe Id="NFe<chave de 44 dígitos>"> — nada a assinar.');
  // Quebra de linha ou tabulação entre as tags é rejeição (588) — e a assinatura seria feita
  // sobre um texto que a SEFAZ normaliza diferente. O builder gera tudo numa linha só.
  if (/[\r\n\t]/.test(xml)) throw new Error('O XML tem quebras de linha/tabulação — não assino.');

  const sig = new SignedXml({
    privateKey: cert.chavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: ALG.RSA_SHA1,
    canonicalizationAlgorithm: ALG.C14N,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infNFe']",
    transforms: [ALG.ENVELOPED, ALG.C14N],
    digestAlgorithm: ALG.SHA1,
  });
  // Último filho de <NFe>: depois do <infNFe> e do <infNFeSupl>, como manda o leiaute.
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
  return sig.getSignedXml();
}

/**
 * Assina o PEDIDO DE INUTILIZAÇÃO. Mesmo padrão da nota (o MOC não abre exceção para este
 * documento), mudando só o que é assinado: o `<infInut>`, referenciado pelo Id de 41 dígitos.
 */
export function assinarInutNFe(xml: string, cert: ChaveDeAssinatura): string {
  if (/<Signature[\s>]/.test(xml)) throw new Error('O pedido já está assinado.');
  if (!/<infInut\b[^>]*\bId="ID\d{41}"/.test(xml))
    throw new Error('XML sem <infInut Id="ID…41 dígitos"> — nada a assinar.');
  if (/[\r\n\t]/.test(xml)) throw new Error('O XML tem quebras de linha/tabulação — não assino.');

  const sig = new SignedXml({
    privateKey: cert.chavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: ALG.RSA_SHA1,
    canonicalizationAlgorithm: ALG.C14N,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infInut']",
    transforms: [ALG.ENVELOPED, ALG.C14N],
    digestAlgorithm: ALG.SHA1,
  });
  sig.computeSignature(xml, { location: { reference: '/*', action: 'append' } });
  return sig.getSignedXml();
}

/**
 * Assina um EVENTO (cancelamento, cancelamento por substituição…). O que se assina é o
 * `<infEvento>`, e a assinatura é irmã dele, dentro de `<evento>` — não da raiz `<envEvento>`.
 */
export function assinarEvento(xml: string, cert: ChaveDeAssinatura): string {
  if (/<Signature[\s>]/.test(xml)) throw new Error('O evento já está assinado.');
  if (!/<infEvento[^>]*\bId="ID\d{52}"/.test(xml))
    throw new Error('XML sem <infEvento Id="ID…52 dígitos"> — nada a assinar.');
  if (/[\r\n\t]/.test(xml)) throw new Error('O XML tem quebras de linha/tabulação — não assino.');

  const sig = new SignedXml({
    privateKey: cert.chavePrivadaPem,
    publicCert: cert.certificadoPem,
    signatureAlgorithm: ALG.RSA_SHA1,
    canonicalizationAlgorithm: ALG.C14N,
  });
  sig.addReference({
    xpath: "//*[local-name(.)='infEvento']",
    transforms: [ALG.ENVELOPED, ALG.C14N],
    digestAlgorithm: ALG.SHA1,
  });
  // Dentro de <evento>, logo depois do <infEvento> — e não na raiz do lote.
  sig.computeSignature(xml, {
    location: { reference: "//*[local-name(.)='evento']", action: 'append' },
  });
  return sig.getSignedXml();
}

/** Confere a assinatura com o certificado que está no próprio XML (KeyInfo). */
export function assinaturaValida(xmlAssinado: string): boolean {
  const m = xmlAssinado.match(/<X509Certificate>([^<]+)<\/X509Certificate>/);
  const assinatura = xmlAssinado.match(/<Signature\b[\s\S]*<\/Signature>/);
  if (!m || !assinatura) return false;
  const pem = `-----BEGIN CERTIFICATE-----\n${m[1].replace(/(.{64})/g, '$1\n')}\n-----END CERTIFICATE-----\n`;
  const v = new SignedXml({ publicCert: pem });
  v.loadSignature(assinatura[0]);
  try {
    return v.checkSignature(xmlAssinado);
  } catch {
    return false;
  }
}
