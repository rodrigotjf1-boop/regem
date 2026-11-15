import { servidorVencido, validadeDoServidor } from './validade-do-servidor';

// ERR-466: a conta estendida (console "Liberar" ou assinatura) estende a licença do servidor da loja.
describe('validadeDoServidor', () => {
  const instalado = new Date('2026-11-21T03:00:00Z');

  it('a conta estendida estende o servidor (o caso da loja: conta até fevereiro, ativação de novembro)', () => {
    const conta = new Date('2027-02-19T03:00:00Z');
    expect(validadeDoServidor(instalado, conta)).toEqual(conta);
    expect(servidorVencido(validadeDoServidor(instalado, conta), new Date('2026-11-22T12:00:00Z'))).toBe(false);
  });

  it('a conta nunca encurta: cancelamento (trial_ate = agora) e teste vencido mantêm a data da ativação', () => {
    expect(validadeDoServidor(instalado, new Date('2026-11-10T00:00:00Z'))).toEqual(instalado);
    expect(validadeDoServidor(instalado, 'lixo')).toEqual(instalado);
  });

  it('sem prazo: ativação sem data, ou conta sem limite (legado)', () => {
    expect(validadeDoServidor(null, new Date('2027-01-01T00:00:00Z'))).toBeNull();
    expect(validadeDoServidor(instalado, null)).toBeNull();
    expect(servidorVencido(null)).toBe(false);
  });

  it('aceita o texto que volta do banco', () => {
    expect(validadeDoServidor('2026-11-21 03:00:00+00', '2027-02-19 03:00:00+00')?.toISOString()).toBe('2027-02-19T03:00:00.000Z');
  });

  it('vencido só depois da data', () => {
    expect(servidorVencido(instalado, new Date('2026-11-21T02:59:59Z'))).toBe(false);
    expect(servidorVencido(instalado, new Date('2026-11-21T03:00:01Z'))).toBe(true);
  });
});
