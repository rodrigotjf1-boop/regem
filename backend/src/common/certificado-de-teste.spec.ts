import { X509Certificate } from 'node:crypto';
import { certificadoDeTeste, inteiro, serieDeTeste } from './certificado-de-teste.teste-spec';

// O ajudante que monta o certificado dos testes de TLS (ERR-350): o INTEGER do DER no menor tamanho — o OpenSSL recusa
// zero sobrando na frente ("illegal padding"), e a série aleatória começava com 0x00 uma vez em 256.
describe('certificado de teste (ERR-350)', () => {
  const sobra = (hex: string) => inteiro(Buffer.from(hex, 'hex')).toString('hex');

  it('o inteiro vai no menor tamanho: tira o zero que sobra e põe o que falta', () => {
    expect(sobra('0010')).toBe('020110'); // zero sobrando na frente de byte baixo: sai
    expect(sobra('000010')).toBe('020110');
    expect(sobra('0090')).toBe('02020090'); // zero necessário (o byte seguinte tem o bit alto): fica
    expect(sobra('90')).toBe('02020090'); // bit alto sem o zero: entra
    expect(sobra('5a')).toBe('02015a');
    expect(sobra('00')).toBe('020100'); // o zero sozinho é o número zero
  });

  it.each([
    ['começa com 0x00 e byte baixo (o que quebrava)', '0010'],
    ['começa com dois zeros', '000010'],
    ['começa com 0x00 e byte alto', '0090'],
    ['começa com byte alto', 'c310'],
  ])('a série que %s ainda dá um certificado que o OpenSSL lê', (_rotulo, inicio) => {
    const serie = Buffer.alloc(12, 0x33);
    Buffer.from(inicio, 'hex').copy(serie);
    const { cert } = certificadoDeTeste(['parceiro.exemplo'], serie);
    expect(new X509Certificate(cert).subjectAltName).toBe('DNS:parceiro.exemplo');
  });

  it('a série padrão é positiva e sem zero na frente (1º byte entre 0x40 e 0x7f)', () => {
    for (let i = 0; i < 200; i += 1) {
      const s = serieDeTeste();
      expect(s.length).toBe(12);
      expect(s[0]).toBeGreaterThanOrEqual(0x40);
      expect(s[0]).toBeLessThanOrEqual(0x7f);
    }
    expect(new X509Certificate(certificadoDeTeste(['parceiro.exemplo']).cert).serialNumber).toHaveLength(24);
  });
});
