import * as forge from 'node-forge';
import {
  CertificadoInvalido,
  diasParaVencer,
  lerCertificadoA1,
  problemasDoCertificado,
} from './certificado';

// Nenhum certificado real entra aqui: o .pfx é fabricado no próprio teste. Chaves de 1024
// bits só para o teste andar rápido — a lógica testada não depende do tamanho.

type Opcoes = {
  cn: string;
  senha: string;
  validoDe?: Date;
  validoAte?: Date;
  algoritmo?: '3des' | 'aes256';
  cadeiaNaFrente?: boolean; // põe o certificado da "autoridade" ANTES do da loja
};

function novoCert(cn: string, chaves: forge.pki.rsa.KeyPair, serial: string, de: Date, ate: Date) {
  const c = forge.pki.createCertificate();
  c.publicKey = chaves.publicKey;
  c.serialNumber = serial;
  c.validity.notBefore = de;
  c.validity.notAfter = ate;
  c.setSubject([{ name: 'commonName', value: cn }]);
  c.setIssuer([{ name: 'commonName', value: 'AC DE TESTE' }]);
  c.sign(chaves.privateKey, forge.md.sha256.create());
  return c;
}

function gerarPfx(o: Opcoes): Buffer {
  const de = o.validoDe ?? new Date(Date.now() - 86_400_000);
  const ate = o.validoAte ?? new Date(Date.now() + 365 * 86_400_000);
  const daLoja = forge.pki.rsa.generateKeyPair(1024);
  const cert = novoCert(o.cn, daLoja, '0a1b2c', de, ate);
  const certs = [cert];
  if (o.cadeiaNaFrente) {
    const daAc = forge.pki.rsa.generateKeyPair(1024);
    certs.unshift(novoCert('AUTORIDADE CERTIFICADORA:00000000000000', daAc, '99', de, ate));
  }
  const asn1 = forge.pkcs12.toPkcs12Asn1(daLoja.privateKey, certs, o.senha, {
    algorithm: o.algoritmo ?? '3des',
  });
  return Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
}

describe('leitura do certificado A1', () => {
  const CN = 'BAR DE TESTE LTDA:12345678000195';

  it('abre o .pfx e extrai titular, CNPJ, série e validade', () => {
    const c = lerCertificadoA1(gerarPfx({ cn: CN, senha: 's3nha' }), 's3nha');
    expect(c.titular).toBe('BAR DE TESTE LTDA');
    expect(c.cnpj).toBe('12345678000195');
    expect(c.serial).toBe('0A1B2C');
    expect(c.chavePrivadaPem).toContain('BEGIN RSA PRIVATE KEY');
    expect(c.certificadoPem).toContain('BEGIN CERTIFICATE');
  });

  it('com a CADEIA junto, escolhe o certificado pela chave — não pela ordem do arquivo', () => {
    const c = lerCertificadoA1(gerarPfx({ cn: CN, senha: 'x', cadeiaNaFrente: true }), 'x');
    // Se pegasse o primeiro, viria o CNPJ 00000000000000 da "autoridade".
    expect(c.cnpj).toBe('12345678000195');
  }, 30000);

  it('também abre .pfx protegido com AES-256', () => {
    const c = lerCertificadoA1(gerarPfx({ cn: CN, senha: 'x', algoritmo: 'aes256' }), 'x');
    expect(c.cnpj).toBe('12345678000195');
  });

  it('senha errada tem mensagem própria — e a mensagem não repete a senha', () => {
    const pfx = gerarPfx({ cn: CN, senha: 'certa' });
    try {
      lerCertificadoA1(pfx, 'SENHA-ERRADA-123');
      throw new Error('deveria ter falhado');
    } catch (e: any) {
      expect(e).toBeInstanceOf(CertificadoInvalido);
      expect(e.message).toMatch(/senha do certificado incorreta/i);
      expect(e.message).not.toContain('SENHA-ERRADA-123');
    }
  });

  it('arquivo que não é .pfx é recusado com mensagem clara', () => {
    expect(() => lerCertificadoA1(Buffer.from('não sou um certificado'), 'x')).toThrow(
      CertificadoInvalido,
    );
    expect(() => lerCertificadoA1(Buffer.alloc(0), 'x')).toThrow(/vazio/);
  });

  it('certificado sem CNPJ (não é e-CNPJ) é recusado', () => {
    expect(() => lerCertificadoA1(gerarPfx({ cn: 'FULANO DE TAL', senha: 'x' }), 'x')).toThrow(
      /e-CNPJ/,
    );
  });
});

describe('o certificado serve para este emitente?', () => {
  const base = {
    cnpj: '12345678000195',
    validoDe: new Date('2025-11-18T00:00:00Z'),
    validoAte: new Date('2026-11-18T00:00:00Z'),
  };
  const hoje = new Date('2026-09-22T12:00:00Z');

  it('mesma raiz de CNPJ e dentro da validade: pode usar', () => {
    expect(problemasDoCertificado(base, '12.345.678/0001-95', hoje)).toEqual([]);
  });

  it('FILIAL usando o certificado da MATRIZ: pode (a SEFAZ compara só a raiz)', () => {
    expect(problemasDoCertificado(base, '12345678000276', hoje)).toEqual([]);
  });

  it('certificado de OUTRA empresa: recusa citando a regra (rejeição 213)', () => {
    const p = problemasDoCertificado(base, '99999999000100', hoje);
    expect(p.join(' ')).toMatch(/raiz do CNPJ/);
  });

  it('vencido ou ainda não válido: recusa', () => {
    expect(problemasDoCertificado(base, base.cnpj, new Date('2026-12-01'))).toContain(
      'O certificado está vencido.',
    );
    expect(problemasDoCertificado(base, base.cnpj, new Date('2025-01-01'))).toContain(
      'O certificado ainda não está na validade.',
    );
  });

  it('conta os dias até vencer (para o aviso da tela)', () => {
    expect(diasParaVencer(base.validoAte, hoje)).toBe(56);
    expect(diasParaVencer(base.validoAte, new Date('2026-12-01'))).toBeLessThan(0);
  });
});
