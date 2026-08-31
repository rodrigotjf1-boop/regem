import { precisaReautorizar, gerarCodigoReauth, hashCodigoReauth } from './reauth-instalacao';

// F3 — a decisão que separa "reinstalação legítima" de "clone com senha vazada".
describe('precisaReautorizar — controle de instalação anti-clone', () => {
  const fpA = 'fp-maquina-A';
  const fpB = 'fp-maquina-B';

  it('1ª instalação (sem fingerprint salvo) → NÃO precisa (segue liso, salva o fp)', () => {
    expect(precisaReautorizar({ reauthAtivo: true, deviceFingerprint: null }, fpA)).toBe(false);
  });

  it('reinstalação na MESMA máquina (fingerprint igual) → NÃO precisa', () => {
    expect(precisaReautorizar({ reauthAtivo: true, deviceFingerprint: fpA }, fpA)).toBe(false);
  });

  it('OUTRA máquina + trava LIGADA → PRECISA (bloqueia o clone)', () => {
    expect(precisaReautorizar({ reauthAtivo: true, deviceFingerprint: fpA }, fpB)).toBe(true);
  });

  it('OUTRA máquina mas trava DESLIGADA (opt-in) → NÃO precisa (sem regressão)', () => {
    expect(precisaReautorizar({ reauthAtivo: false, deviceFingerprint: fpA }, fpB)).toBe(false);
  });

  it('ativação inexistente → NÃO precisa', () => {
    expect(precisaReautorizar(null, fpA)).toBe(false);
    expect(precisaReautorizar(undefined, fpA)).toBe(false);
  });

  it('fingerprint vazio (leitura falhou) → NÃO precisa aqui (tratado no fluxo)', () => {
    expect(precisaReautorizar({ reauthAtivo: true, deviceFingerprint: fpA }, '')).toBe(false);
  });
});

describe('código de re-autorização (e-mail)', () => {
  it('gera 6 dígitos', () => {
    expect(gerarCodigoReauth()).toMatch(/^\d{6}$/);
  });

  it('hash é estável, não é o código em claro, e difere entre códigos', () => {
    expect(hashCodigoReauth('123456')).toBe(hashCodigoReauth('123456'));
    expect(hashCodigoReauth('123456')).not.toContain('123456');
    expect(hashCodigoReauth('123456')).not.toBe(hashCodigoReauth('654321'));
  });
});
