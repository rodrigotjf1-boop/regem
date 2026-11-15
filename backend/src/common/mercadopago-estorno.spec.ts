import { estornarTudoMP } from './mercadopago';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ESTORNO TOTAL DO PIX PELO MERCADO PAGO (ERR-472): o pedido #71 (R$ 65,00) foi estornado com o corpo vazio e o cliente
// recebeu R$ 64,54. Agora: lê o pagamento, pede com o VALOR CHEIO explícito, cai na forma antiga se o valor for recusado
// e devolve quanto voltou. O Mercado Pago é de mentira (o `fetch` do teste), com as respostas no formato da API.

type Chamada = { url: string; metodo: string; corpo: any; chave: string | null };

function mpDeMentira(o: { total: number; devolvidoAntes?: number; devolveNoEstorno?: (corpo: any) => number; recusaValor?: boolean }) {
  const chamadas: Chamada[] = [];
  let devolvido = o.devolvidoAntes ?? 0;
  const fetchFalso = async (url: string, init: any = {}) => {
    const metodo = init.method ?? 'GET';
    const corpo = init.body ? JSON.parse(init.body) : null;
    chamadas.push({ url, metodo, corpo, chave: init.headers?.['X-Idempotency-Key'] ?? null });
    if (metodo === 'GET') return { ok: true, status: 200, json: async () => ({ transaction_amount: o.total, transaction_amount_refunded: devolvido }) } as any;
    if (o.recusaValor && corpo?.amount != null)
      return { ok: false, status: 400, text: async () => '{"message":"invalid refund amount"}' } as any;
    devolvido += o.devolveNoEstorno ? o.devolveNoEstorno(corpo) : (corpo?.amount ?? o.total);
    return { ok: true, status: 201, json: async () => ({ id: 999, status: 'approved' }) } as any;
  };
  return { chamadas, fetchFalso };
}

describe('estorno total do Pix pelo Mercado Pago (ERR-472)', () => {
  const original = global.fetch;
  afterEach(() => {
    global.fetch = original;
  });

  it('pede o estorno com o valor cheio explícito e diz quanto voltou', async () => {
    const mp = mpDeMentira({ total: 65 });
    global.fetch = mp.fetchFalso as any;
    const r = await estornarTudoMP('tk', '123');
    expect(r).toEqual({ id: '999', status: 'approved', total: 65, devolvido: 65 });
    const post = mp.chamadas.find((c) => c.metodo === 'POST')!;
    expect(post.url).toBe('https://api.mercadopago.com/v1/payments/123/refunds');
    expect(post.corpo).toEqual({ amount: 65 }); // antes: corpo vazio
    expect(post.chave).toBe('refund-123-cheio');
  });

  it('o Mercado Pago recusa o valor: pede da forma de antes (corpo vazio), com outra chave, e diz quanto voltou de fato', async () => {
    const mp = mpDeMentira({ total: 65, recusaValor: true, devolveNoEstorno: () => 64.54 });
    global.fetch = mp.fetchFalso as any;
    const r = await estornarTudoMP('tk', '123');
    expect(r.devolvido).toBe(64.54); // quem chama abre o caso da diferença
    const posts = mp.chamadas.filter((c) => c.metodo === 'POST');
    expect(posts.map((p) => [p.corpo, p.chave])).toEqual([
      [{ amount: 65 }, 'refund-123-cheio'],
      [null, 'refund-123'],
    ]);
  });

  it('já devolvido por inteiro: nem pede de novo', async () => {
    const mp = mpDeMentira({ total: 65, devolvidoAntes: 65 });
    global.fetch = mp.fetchFalso as any;
    expect(await estornarTudoMP('tk', '123')).toMatchObject({ devolvido: 65, total: 65 });
    expect(mp.chamadas.filter((c) => c.metodo === 'POST')).toHaveLength(0);
  });

  it('parte já devolvida: pede só o que falta', async () => {
    const mp = mpDeMentira({ total: 65, devolvidoAntes: 20 });
    global.fetch = mp.fetchFalso as any;
    await estornarTudoMP('tk', '123');
    expect(mp.chamadas.find((c) => c.metodo === 'POST')!.corpo).toEqual({ amount: 45 });
  });

  it('a leitura do pagamento falha: estorna da forma de antes e não inventa o quanto voltou', async () => {
    const chamadas: string[] = [];
    global.fetch = (async (_url: string, init: any = {}) => {
      chamadas.push(init.method ?? 'GET');
      if ((init.method ?? 'GET') === 'GET') return { ok: false, status: 500, text: async () => '' } as any;
      return { ok: true, status: 201, json: async () => ({ id: 7, status: 'approved' }) } as any;
    }) as any;
    expect(await estornarTudoMP('tk', '123')).toEqual({ id: '7', status: 'approved', total: null, devolvido: null });
    expect(chamadas).toEqual(['GET', 'POST', 'GET']);
  });

  it('erro que não é recusa do valor (5xx) não tenta a outra forma: sobe para a rotina repetir', async () => {
    let posts = 0;
    global.fetch = (async (_url: string, init: any = {}) => {
      if ((init.method ?? 'GET') === 'GET') return { ok: true, status: 200, json: async () => ({ transaction_amount: 65, transaction_amount_refunded: 0 }) } as any;
      posts++;
      return { ok: false, status: 503, text: async () => 'indisponível' } as any;
    }) as any;
    await expect(estornarTudoMP('tk', '123')).rejects.toThrow('Mercado Pago refund 503');
    expect(posts).toBe(1);
  });
});
