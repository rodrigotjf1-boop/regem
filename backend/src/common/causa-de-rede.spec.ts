import { causaDeRede } from './causa-de-rede';
import { fetchExterno } from './fetch-externo';
import { AppError } from './errors/app-error';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ERR-239: o "Publicar no GoGeM" mostrava só "fetch failed" — o motivo (ENOTFOUND api-stg…) estava em
// `err.cause`, e um nível abaixo quando a chamada passa pelo `fetchExterno`.
const falhaDoFetch = (cause: any) => {
  const e: any = new TypeError('fetch failed');
  e.cause = cause;
  return e;
};

describe('causaDeRede (ERR-239)', () => {
  it('o "fetch failed" do Node: código e host, tirados da mensagem da causa', () => {
    expect(causaDeRede(falhaDoFetch({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api-stg.gogem.com.br' }))).toBe(
      'ENOTFOUND api-stg.gogem.com.br',
    );
  });

  it('usa hostname / address:port quando a causa os traz', () => {
    expect(causaDeRede(falhaDoFetch({ code: 'ENOTFOUND', hostname: 'api-stg.gogem.com.br', message: 'x' }))).toBe('ENOTFOUND api-stg.gogem.com.br');
    expect(causaDeRede(falhaDoFetch({ code: 'ECONNREFUSED', address: '10.0.0.5', port: 443, message: 'connect ECONNREFUSED 10.0.0.5:443' }))).toBe(
      'ECONNREFUSED 10.0.0.5:443',
    );
  });

  it('pelo fetchExterno (AppError → TypeError → causa): acha a causa lá embaixo', async () => {
    const espiao = jest.spyOn(global, 'fetch').mockRejectedValue(falhaDoFetch({ code: 'ENOTFOUND', message: 'getaddrinfo ENOTFOUND api-stg.gogem.com.br' }));
    try {
      const e = await fetchExterno('https://api-stg.gogem.com.br/x').catch((x) => x);
      expect(e).toBeInstanceOf(AppError);
      expect(causaDeRede(e)).toBe('ENOTFOUND api-stg.gogem.com.br');
    } finally {
      espiao.mockRestore();
    }
  });

  it('tempo esgotado: o do fetchExterno e o do AbortController', () => {
    expect(causaDeRede(AppError.externalTimeout())).toBe('tempo esgotado');
    const abort: any = new Error('This operation was aborted');
    abort.name = 'AbortError';
    expect(causaDeRede(abort)).toBe('tempo esgotado');
  });

  it('código sem host: o código e a mensagem; nunca a query da URL (pode levar token)', () => {
    expect(causaDeRede(falhaDoFetch({ code: 'UND_ERR_SOCKET', message: 'other side closed https://x.y/z?token=SEGREDO' }))).toBe(
      'UND_ERR_SOCKET: other side closed https://x.y/z',
    );
  });

  it('sem causa de rede: null (quem chama mostra a mensagem de sempre)', () => {
    expect(causaDeRede(new Error('qualquer coisa'))).toBeNull();
    expect(causaDeRede(new TypeError('fetch failed'))).toBeNull();
    expect(causaDeRede(undefined)).toBeNull();
  });
});
