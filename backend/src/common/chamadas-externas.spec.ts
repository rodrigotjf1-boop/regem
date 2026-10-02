import { fetchExterno } from './fetch-externo';
import { destinoSemQuery, observarChamadasExternas, trechoSeguro } from './chamadas-externas';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O OBSERVADOR das chamadas a serviços externos — a base do registro dos envios do pedido
// (mig 305). O que ele NÃO pode fazer: mudar a chamada, vazar credencial, ou misturar duas
// requisições que acontecem ao mesmo tempo.

describe('observador das chamadas externas', () => {
  const fetchOriginal = global.fetch;
  afterEach(() => {
    global.fetch = fetchOriginal;
  });
  const responder = (fn: (url: string, init: any) => Response | Promise<Response>) => {
    global.fetch = jest.fn(fn as any) as any;
  };

  it('fora de uma observação nada é anotado e a resposta é a mesma', async () => {
    const res = new Response('{"ok":true}', { status: 200 });
    responder(() => res);
    const r = await fetchExterno('https://canal.exemplo/api/pedido/1/confirm', { method: 'POST' });
    expect(r).toBe(res); // o mesmo objeto: ninguém leu nem clonou
    expect(await r.json()).toEqual({ ok: true });
  });

  it('dentro da observação anota método, destino SEM a query, código e o trecho da resposta', async () => {
    responder(() => new Response('{"error":"pedido já finalizado"}', { status: 409 }));
    const obs = await observarChamadasExternas(async () => {
      const r = await fetchExterno('https://canal.exemplo/v1/order/ready?auth_token=SEGREDO123&order_id=9', { method: 'GET' });
      return r.ok;
    });
    expect(obs.lancou).toBe(false);
    expect(obs.valor).toBe(false);
    expect(obs.chamadas).toHaveLength(1);
    expect(obs.chamadas[0]).toMatchObject({ metodo: 'GET', destino: 'canal.exemplo/v1/order/ready', status: 409, ok: false, trecho: '{"error":"pedido já finalizado"}' });
    expect(JSON.stringify(obs.chamadas)).not.toContain('SEGREDO123');
  });

  it('quem chamou ainda lê a resposta inteira (o trecho sai de uma cópia)', async () => {
    responder(() => new Response('{"errno":0,"data":{"x":1}}', { status: 200 }));
    const obs = await observarChamadasExternas(async () => {
      const r = await fetchExterno('https://canal.exemplo/a', { method: 'POST' });
      return r.json();
    });
    expect(obs.valor).toEqual({ errno: 0, data: { x: 1 } });
    expect(obs.chamadas[0].trecho).toBe('{"errno":0,"data":{"x":1}}');
  });

  it('tempo esgotado e falha de rede são anotados — e o erro continua sendo lançado como antes', async () => {
    responder(() => {
      const e: any = new Error('aborted');
      e.name = 'TimeoutError';
      throw e;
    });
    let obs = await observarChamadasExternas(() => fetchExterno('https://canal.exemplo/lento', { method: 'POST' }));
    expect(obs.lancou).toBe(true);
    expect((obs.erro as any)?.code).toBe('EXTERNAL_SERVICE_TIMEOUT');
    expect(obs.chamadas[0]).toMatchObject({ status: null, ok: false, erro: 'timeout' });

    responder(() => {
      throw new Error('ECONNRESET');
    });
    obs = await observarChamadasExternas(() => fetchExterno('https://canal.exemplo/caiu'));
    expect(obs.lancou).toBe(true);
    expect(obs.chamadas[0]).toMatchObject({ metodo: 'GET', status: null, erro: 'rede' });
  });

  it('duas observações ao mesmo tempo não se enxergam', async () => {
    responder(async (url) => {
      await new Promise((r) => setTimeout(r, url.includes('lenta') ? 30 : 5));
      return new Response(url.includes('lenta') ? 'A' : 'B', { status: url.includes('lenta') ? 200 : 500 });
    });
    const [a, b] = await Promise.all([
      observarChamadasExternas(() => fetchExterno('https://canal.exemplo/lenta')),
      observarChamadasExternas(() => fetchExterno('https://canal.exemplo/rapida')),
    ]);
    expect(a.chamadas.map((c) => c.destino)).toEqual(['canal.exemplo/lenta']);
    expect(b.chamadas.map((c) => c.destino)).toEqual(['canal.exemplo/rapida']);
    expect(a.chamadas[0].trecho).toBe('A');
    expect(b.chamadas[0].status).toBe(500);
  });

  it('o erro de quem envia não escapa: volta em `erro`', async () => {
    const obs = await observarChamadasExternas(async () => {
      throw new Error('sem token');
    });
    expect(obs.lancou).toBe(true);
    expect((obs.erro as Error).message).toBe('sem token');
    expect(obs.chamadas).toEqual([]);
  });

  it('o trecho guardado é curto e sem nada com cara de credencial', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123456';
    const t = trechoSeguro(`{"message":"token inválido","token":"${jwt}"}\n\n  ${'x'.repeat(600)}`);
    expect(t).not.toContain(jwt);
    expect(t).toContain('token inválido');
    expect(t.length).toBeLessThanOrEqual(240);
    expect(destinoSemQuery('https://usuario:senha@canal.exemplo/a/b?token=1#x')).toBe('canal.exemplo/a/b');
    expect(destinoSemQuery('isto não é url?x=1')).toBe('isto não é url');
  });
});
