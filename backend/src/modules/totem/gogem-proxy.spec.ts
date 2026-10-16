import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { GogemProxyService, caminhoParaNuvem } from './gogem-proxy.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-239: sem conexão com a nuvem do GoGeM, o log dizia só "fetch failed". A causa vai para o log e
// para o campo `motivo`; o texto da tela do totem (para o cliente) continua o mesmo.
describe('repasse sem conexão (ERR-239)', () => {
  it('503 com o texto de sempre; a causa no log e em `motivo`; nenhum cabeçalho vaza', async () => {
    const log = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const f = jest.spyOn(global, 'fetch').mockImplementation(() => {
      const e: any = new TypeError('fetch failed');
      e.cause = { code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api.gogem.com.br' };
      return Promise.reject(e);
    });
    try {
      const err: any = await new GogemProxyService()
        .encaminhar({ method: 'POST', originalUrl: '/api/v1/pagamentos/pix', headers: { 'x-device-token': 'segredo-do-totem' }, body: { valor: 1 } })
        .catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getResponse()).toMatchObject({
        message: 'Sem conexão com a nuvem agora — tente de novo em instantes.',
        motivo: 'ENOTFOUND api.gogem.com.br',
      });
      const linhas = log.mock.calls.map((c) => String(c[0])).join('\n');
      expect(linhas).toContain('ENOTFOUND api.gogem.com.br');
      expect(linhas + JSON.stringify(err.getResponse())).not.toContain('segredo-do-totem');
    } finally {
      log.mockRestore();
      f.mockRestore();
    }
  });
});

// Errar o caminho do repasse manda pagamento para o lugar errado — por isso tem teste.
describe('caminhoParaNuvem (R3c)', () => {
  it('tira o prefixo global e preserva o resto', () => {
    expect(caminhoParaNuvem('/api/v1/pagamentos/point')).toBe('/pagamentos/point');
    expect(caminhoParaNuvem('/api/v1/publico/dispositivos/parear')).toBe(
      '/publico/dispositivos/parear',
    );
  });

  it('preserva a query (id da cobrança, versão do catálogo…)', () => {
    expect(caminhoParaNuvem('/api/v1/kiosk/latest?versionCode=12')).toBe(
      '/kiosk/latest?versionCode=12',
    );
  });

  it('não corta caminho que só COMEÇA parecido', () => {
    expect(caminhoParaNuvem('/api/v1x/pagamentos')).toBe('/api/v1x/pagamentos');
  });

  it('sempre devolve caminho absoluto', () => {
    expect(caminhoParaNuvem('pagamentos/pix')).toBe('/pagamentos/pix');
    expect(caminhoParaNuvem(undefined)).toBe('/');
  });
});
