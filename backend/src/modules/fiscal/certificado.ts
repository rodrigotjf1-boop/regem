import * as forge from 'node-forge';

// LEITURA DO CERTIFICADO DIGITAL A1 (.pfx / PKCS#12) DA LOJA.
//
// O .pfx vem da autoridade certificadora com a CADEIA inteira (o certificado da empresa e os
// das autoridades acima dele). O certificado que assina é o que casa com a CHAVE PRIVADA do
// arquivo — por isso a escolha é pela chave, e não pelo primeiro da lista (em alguns .pfx o
// primeiro é o da autoridade, e assinar com ele é rejeição certa).
//
// O que sai daqui para o banco é só o PÚBLICO (titular, CNPJ, série, validade); a chave e o
// certificado em PEM ficam em memória, para a assinatura (etapa B do P2).

export interface CertificadoA1 {
  titular: string; // razão social, como está no certificado
  cnpj: string; // 14 dígitos
  serial: string; // número de série (hex), para identificar este certificado entre renovações
  validoDe: Date;
  validoAte: Date;
  chavePrivadaPem: string;
  certificadoPem: string;
}

export class CertificadoInvalido extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'CertificadoInvalido';
  }
}

const soDig = (s: unknown) => String(s ?? '').replace(/\D/g, '');

// ICP-Brasil: no e-CNPJ o CN é "RAZÃO SOCIAL:CNPJ". Como segunda fonte, o CNPJ também vem no
// otherName 2.16.76.1.3.3 do subjectAltName (DOC-ICP-04).
function cnpjDoCertificado(cert: forge.pki.Certificate): string {
  const cn = String(cert.subject.getField('CN')?.value ?? '');
  const doCn = soDig(cn.split(':').pop());
  if (doCn.length === 14) return doCn;
  const san: any = cert.getExtension('subjectAltName');
  for (const nome of san?.altNames ?? []) {
    // otherName (tipo 0) cujo valor carrega o CNPJ em 14 dígitos
    const d = soDig(typeof nome.value === 'string' ? nome.value : '');
    if (nome.type === 0 && d.length >= 14) return d.slice(-14);
  }
  return '';
}

function titularDoCertificado(cert: forge.pki.Certificate): string {
  const cn = String(cert.subject.getField('CN')?.value ?? '');
  return cn.includes(':') ? cn.slice(0, cn.lastIndexOf(':')).trim() : cn.trim();
}

/** Abre o .pfx com a senha. Erros com mensagem clara e SEM repetir a senha. */
export function lerCertificadoA1(pfx: Buffer, senha: string): CertificadoA1 {
  if (!pfx?.length) throw new CertificadoInvalido('Arquivo do certificado vazio.');
  let p12: forge.pkcs12.Pkcs12Pfx;
  try {
    const asn1 = forge.asn1.fromDer(forge.util.createBuffer(pfx.toString('binary')));
    p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, senha ?? '');
  } catch (e: any) {
    const m = String(e?.message ?? '');
    if (/password|MAC could not be verified|Invalid/i.test(m))
      throw new CertificadoInvalido('Senha do certificado incorreta.');
    if (/Unsupported|not supported|OID/i.test(m))
      throw new CertificadoInvalido(
        'O formato de proteção deste .pfx não é suportado. Exporte o certificado de novo ' +
          'marcando a criptografia "TripleDES-SHA1" e tente outra vez.',
      );
    throw new CertificadoInvalido('O arquivo enviado não é um certificado A1 (.pfx) válido.');
  }

  const chaves = [
    ...(p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? []),
    ...(p12.getBags({ bagType: forge.pki.oids.keyBag })[forge.pki.oids.keyBag] ?? []),
  ]
    .map((b) => b.key as forge.pki.rsa.PrivateKey | undefined)
    .filter((k): k is forge.pki.rsa.PrivateKey => !!k);
  if (!chaves.length)
    throw new CertificadoInvalido('O .pfx não traz a chave privada — sem ela não há como assinar.');
  const chave = chaves[0];

  const certs = (p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [])
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => !!c);
  // O certificado da loja é o que tem a MESMA chave pública da chave privada.
  const cert = certs.find((c) => {
    const pub = c.publicKey as forge.pki.rsa.PublicKey;
    return pub?.n && pub.n.equals(chave.n) && pub.e.equals(chave.e);
  });
  if (!cert)
    throw new CertificadoInvalido('O .pfx não traz o certificado correspondente à chave privada.');

  const cnpj = cnpjDoCertificado(cert);
  if (cnpj.length !== 14)
    throw new CertificadoInvalido(
      'Não encontrei o CNPJ neste certificado — ele precisa ser um e-CNPJ (A1) da empresa.',
    );

  return {
    titular: titularDoCertificado(cert),
    cnpj,
    serial: String(cert.serialNumber ?? '').toUpperCase(),
    validoDe: cert.validity.notBefore,
    validoAte: cert.validity.notAfter,
    chavePrivadaPem: forge.pki.privateKeyToPem(chave),
    certificadoPem: forge.pki.certificateToPem(cert),
  };
}

/**
 * Serve para ESTE emitente, AGORA? Devolve os problemas (vazio = pode usar).
 *
 * A SEFAZ compara a RAIZ do CNPJ (8 primeiros dígitos) do certificado com a do emitente —
 * rejeição 213 "CNPJ-Base do Emitente difere do CNPJ-Base do Certificado Digital". Por isso a
 * filial pode usar o certificado da matriz, mas não o de outra empresa.
 */
export function problemasDoCertificado(
  c: Pick<CertificadoA1, 'cnpj' | 'validoDe' | 'validoAte'>,
  cnpjEmitente: string | null | undefined,
  agora: Date = new Date(),
): string[] {
  const p: string[] = [];
  const emit = soDig(cnpjEmitente);
  if (emit.length === 14 && c.cnpj.slice(0, 8) !== emit.slice(0, 8))
    p.push(
      `O certificado é do CNPJ ${c.cnpj.slice(0, 8)}…, e o emitente configurado é ${emit.slice(0, 8)}… ` +
        '(a SEFAZ rejeita: a raiz do CNPJ tem de ser a mesma).',
    );
  if (agora < c.validoDe) p.push('O certificado ainda não está na validade.');
  if (agora > c.validoAte) p.push('O certificado está vencido.');
  return p;
}

/** Dias até vencer (negativo = vencido). Para o aviso na tela. */
export function diasParaVencer(validoAte: Date, agora: Date = new Date()): number {
  return Math.floor((validoAte.getTime() - agora.getTime()) / 86_400_000);
}
