import { CfThrottlerGuard } from '../common/cf-throttler.guard';
import { BILHETES_NO_MAXIMO, CABECALHO_DO_BILHETE, VALIDADE_DO_BILHETE_MS, bilhetesVivos, cabecalhoDoBilhete, consumirBilhete, emitirBilhete, espiarBilhete, resumoDoCorpo } from './bilhete-do-mister';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O bilhete de uma leitura do Mister (versão 10, C3): uma chamada, um caminho exato, só GET, 30 segundos.

const A = { tenantId: 'empresa-a', colaboradorId: 'pessoa-a', caminho: '/api/v1/unidades' };

describe('o bilhete de uma leitura do Mister', () => {
  it('abre UMA vez o caminho exato, com GET, e se gasta', () => {
    const id = emitirBilhete(A);
    expect(id).toMatch(/^[0-9a-f]{64}$/);
    expect(espiarBilhete(id)).toMatchObject({ tenantId: 'empresa-a', colaboradorId: 'pessoa-a' });
    expect(consumirBilhete(id, 'get', '/api/v1/unidades')).toMatchObject({ tenantId: 'empresa-a' });
    expect(consumirBilhete(id, 'GET', '/api/v1/unidades')).toBeNull();
    expect(espiarBilhete(id)).toBeNull();
  });

  it('o método ou o caminho errado gasta o bilhete sem abrir nada', () => {
    const post = emitirBilhete(A);
    expect(consumirBilhete(post, 'POST', '/api/v1/unidades')).toBeNull();
    expect(consumirBilhete(post, 'GET', '/api/v1/unidades')).toBeNull();
    const outro = emitirBilhete(A);
    expect(consumirBilhete(outro, 'GET', '/api/v1/unidades?todas=1')).toBeNull();
    expect(consumirBilhete(outro, 'GET', '/api/v1/unidades')).toBeNull();
  });

  it('vence em 30 segundos; formato errado e desconhecido não abrem', () => {
    const agora = Date.now();
    const id = emitirBilhete(A, agora);
    expect(espiarBilhete(id, agora + VALIDADE_DO_BILHETE_MS - 1)).not.toBeNull();
    expect(consumirBilhete(id, 'GET', A.caminho, agora + VALIDADE_DO_BILHETE_MS)).toBeNull();
    for (const ruim of [undefined, null, 123, '', 'abc', 'A'.repeat(64), 'f'.repeat(64), `${'a'.repeat(63)}g`]) expect(espiarBilhete(ruim)).toBeNull();
  });

  it('o cabeçalho é lido do jeito que chega (o primeiro, se vier repetido)', () => {
    expect(cabecalhoDoBilhete({ headers: { [CABECALHO_DO_BILHETE]: 'x' } })).toBe('x');
    expect(cabecalhoDoBilhete({ headers: { [CABECALHO_DO_BILHETE]: ['y', 'z'] } })).toBe('y');
    expect(cabecalhoDoBilhete({ headers: {} })).toBeUndefined();
    expect(cabecalhoDoBilhete(undefined)).toBeUndefined();
  });

  it('com bilhetes demais vivos, recusa emitir (quem chama diz "não consegui ler agora")', () => {
    const agora = Date.now() + 10 * VALIDADE_DO_BILHETE_MS; // os de antes já venceram
    const emitidos: string[] = [];
    try {
      while (bilhetesVivos() < BILHETES_NO_MAXIMO) emitidos.push(emitirBilhete(A, agora));
      expect(() => emitirBilhete(A, agora)).toThrow('bilhetes_demais');
    } finally {
      for (const id of emitidos) consumirBilhete(id, 'GET', A.caminho, agora);
    }
    expect(bilhetesVivos()).toBe(0);
  });

  it('C4: o bilhete de escrita abre só o mesmo método, o mesmo caminho e o MESMO corpo', () => {
    const corpo = { nome: 'Bar', unidadeId: 'loja-1' };
    const escrever = (c: unknown = corpo) => emitirBilhete({ ...A, caminho: '/api/v1/setores', metodo: 'POST', corpoHash: resumoDoCorpo(c) });
    expect(consumirBilhete(escrever(), 'POST', '/api/v1/setores', Date.now(), { nome: 'Bar', unidadeId: 'loja-1' })).toMatchObject({ metodo: 'POST' });
    expect(consumirBilhete(escrever(), 'POST', '/api/v1/setores', Date.now(), { nome: 'Bar', unidadeId: 'loja-2' })).toBeNull();
    expect(consumirBilhete(escrever(), 'PATCH', '/api/v1/setores', Date.now(), corpo)).toBeNull();
    expect(consumirBilhete(escrever(), 'GET', '/api/v1/setores')).toBeNull();
    // Sem o resumo do corpo, a escrita nunca abre.
    expect(consumirBilhete(emitirBilhete({ ...A, caminho: '/api/v1/setores', metodo: 'POST' }), 'POST', '/api/v1/setores', Date.now(), corpo)).toBeNull();
    // O de leitura não abre escrita.
    expect(consumirBilhete(emitirBilhete({ ...A, caminho: '/api/v1/setores' }), 'POST', '/api/v1/setores', Date.now(), corpo)).toBeNull();
    expect(bilhetesVivos()).toBe(0);
  });

  it('o limite de chamadas conta o bilhete vivo pela EMPRESA, sem gastá-lo; o falso fica no balde do IP', async () => {
    const guarda = Object.create(CfThrottlerGuard.prototype) as any;
    const id = emitirBilhete(A);
    expect(await guarda.getTracker({ headers: { [CABECALHO_DO_BILHETE]: id }, ip: '127.0.0.1' })).toBe('mister:empresa-a');
    expect(espiarBilhete(id)).not.toBeNull();
    expect(await guarda.getTracker({ headers: { [CABECALHO_DO_BILHETE]: 'b'.repeat(64) }, ip: '127.0.0.1' })).toBe('127.0.0.1');
    consumirBilhete(id, 'GET', A.caminho);
  });
});
