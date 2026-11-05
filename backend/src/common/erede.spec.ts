import {
  __esquecerTokensRede,
  consultarPagamentoRede,
  criarPixRede,
  horaDeBrasilia,
  reembolsarPagamentoRede,
  validarCredencialRede,
} from './erede';
import { GatewayError } from './gateway-erro';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PIX DO E.REDE. As respostas abaixo são as do sandbox da Rede em 05/11/2026 (fase 4 do estudo), sem o QR.
// O que se prova: o corpo que sai (referência, valor em centavos, validade na hora de Brasília), o "gerar de novo"
// devolvendo o MESMO PIX (código 42 → consulta pela referência), a leitura das duas formas da consulta
// (pendente × pago), a classificação das falhas (o que é seguro cair no próximo gateway) e o token guardado.

const CRED = { pv: '12345678', chave: 'chave-de-teste' };
const QR = { qrCodeImage: 'iVBORw0KGgoAAAANSUhEUg', qrCodeData: '00020101021226870014br.gov.bcb.pix' };

const PENDENTE = {
  requestDateTime: '2026-11-05T04:04:08-03:00',
  qrCodeResponse: {
    dateTime: '2026-11-05T04:04:07-03:00', returnCode: '00', returnMessage: 'Success.', affiliation: 12345678, kind: 'Pix',
    reference: 'pedido-x', amount: 700, tid: '40012611050404073787', status: 'Pending',
    expirationQrCode: '2026-11-05T04:14:06-03:00', ...QR, origin: 1, txId: 'REZZ1234560012345678261105040407AGB',
  },
};
const PAGO = {
  requestDateTime: '2026-11-05T04:05:13-03:00',
  authorization: {
    dateTime: '2026-11-05T04:04:07-03:00', returnCode: '00', returnMessage: 'Success.', affiliation: 12345678, kind: 'Pix',
    reference: 'pedido-x', amount: 700, tid: '40012611050404073787', status: 'Approved', origin: 1,
  },
  capture: { dateTime: '2026-11-05T04:05:07-03:00', amount: 700 },
};

type Chamada = { url: string; init: any };
let chamadas: Chamada[];
let respostas: Array<(c: Chamada) => { status: number; corpo: any } | Error>;
const fetchOriginal = global.fetch;

function responder(...r: typeof respostas) {
  respostas = r;
}
const json = (status: number, corpo: any) => () => ({ status, corpo });
const TOKEN = json(200, { access_token: 'tk-1', scope: 'x', token_type: 'Bearer', expires_in: 1439 });

beforeEach(() => {
  __esquecerTokensRede();
  chamadas = [];
  respostas = [];
  global.fetch = (async (url: any, init: any) => {
    const c = { url: String(url), init };
    chamadas.push(c);
    const proxima = respostas.shift();
    if (!proxima) throw new Error(`fetch inesperado: ${c.url}`);
    const r = proxima(c);
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.corpo), { status: r.status, headers: { 'content-type': 'application/json' } });
  }) as any;
  delete process.env.REDE_AMBIENTE;
});
afterAll(() => {
  global.fetch = fetchOriginal;
});

describe('criarPixRede', () => {
  it('manda referência, número do pedido sem traços, valor em centavos e a validade na hora de Brasília', async () => {
    process.env.REDE_AMBIENTE = 'sandbox';
    responder(TOKEN, json(200, { tid: '400126', reference: 'pedido-1', amount: 1990, qrCodeResponse: { dateTimeExpiration: 'x', ...QR }, returnCode: '00', returnMessage: 'Success.' }));
    const vence = new Date('2026-11-05T15:10:00Z'); // 12:10 em Brasília
    const pix = await criarPixRede(CRED, { valor: 19.9, idempotencia: 'pedido-0a1b2c3d-1111-2222-3333-444455556666', referenciaExterna: '0a1b2c3d-1111-2222-3333-444455556666', expiraEm: vence });

    expect(chamadas[0].url).toBe('https://rl7-sandbox-api.useredecloud.com.br/oauth2/token');
    expect(chamadas[0].init.headers.Authorization).toBe(`Basic ${Buffer.from('12345678:chave-de-teste').toString('base64')}`);
    expect(chamadas[0].init.body).toBe('grant_type=client_credentials');
    expect(chamadas[1].url).toBe('https://sandbox-erede.useredecloud.com.br/v2/transactions');
    expect(chamadas[1].init.headers.Authorization).toBe('Bearer tk-1');
    expect(JSON.parse(chamadas[1].init.body)).toEqual({
      kind: 'Pix',
      reference: 'pedido-0a1b2c3d-1111-2222-3333-444455556666',
      orderId: '0a1b2c3d111122223333444455556666',
      amount: 1990,
      qrCode: { dateTimeExpiration: '2026-11-05T12:10:00' },
    });
    expect(pix).toEqual({ id: '400126', status: 'pending', qrCode: QR.qrCodeData, qrCodeBase64: QR.qrCodeImage, ticketUrl: null });
  });

  it('produção por padrão', async () => {
    responder(TOKEN, json(200, { tid: '1', returnCode: '00', qrCodeResponse: QR }));
    await criarPixRede(CRED, { valor: 1, idempotencia: 'pedido-a', referenciaExterna: 'a' });
    expect(chamadas[0].url).toBe('https://api.userede.com.br/redelabs/oauth2/token');
    expect(chamadas[1].url).toBe('https://api.userede.com.br/erede/v2/transactions');
  });

  it('gerar de novo para o mesmo pedido (código 42) devolve o MESMO PIX pela consulta da referência — nunca um 2º', async () => {
    responder(
      TOKEN,
      json(422, { returnCode: '42', returnMessage: 'Reference: Order number already exists.' }),
      json(200, PENDENTE),
    );
    const pix = await criarPixRede(CRED, { valor: 7, idempotencia: 'pedido-x', referenciaExterna: 'x' });
    expect(chamadas[2].url).toBe('https://api.userede.com.br/erede/v2/transactions?reference=pedido-x');
    expect(chamadas[2].init.method).toBe('GET');
    expect(pix).toEqual({ id: '40012611050404073787', status: 'pending', qrCode: QR.qrCodeData, qrCodeBase64: QR.qrCodeImage, ticketUrl: null });
    expect(chamadas.filter((c) => c.init.method === 'POST' && c.url.endsWith('/v2/transactions'))).toHaveLength(1);
  });

  it('recusa da Rede (4xx) é DEFINITIVA: seguro tentar o próximo gateway; 5xx e queda de rede são AMBÍGUAS', async () => {
    responder(TOKEN, json(400, { returnCode: '3077', returnMessage: 'QrCode: Expiration Date Invalid parameter value.' }));
    const e1 = await criarPixRede(CRED, { valor: 3, idempotencia: 'pedido-a', referenciaExterna: 'a' }).catch((e) => e);
    expect(e1).toBeInstanceOf(GatewayError);
    expect(e1.ambiguo).toBe(false);
    expect(e1.message).toContain('3077');

    responder(json(503, { returnMessage: 'indisponível' }));
    const e2 = await criarPixRede(CRED, { valor: 3, idempotencia: 'pedido-b', referenciaExterna: 'b' }).catch((e) => e);
    expect(e2.ambiguo).toBe(true);

    responder(() => new TypeError('fetch failed'));
    const e3 = await criarPixRede(CRED, { valor: 3, idempotencia: 'pedido-c', referenciaExterna: 'c' }).catch((e) => e);
    expect(e3.ambiguo).toBe(true);
  });

  it('PV ou chave recusados no login: erro definitivo e claro, sem nada cobrado', async () => {
    responder(json(401, { error: 'invalid_client' }));
    const e = await criarPixRede(CRED, { valor: 3, idempotencia: 'pedido-a', referenciaExterna: 'a' }).catch((x) => x);
    expect(e).toBeInstanceOf(GatewayError);
    expect(e.ambiguo).toBe(false);
    expect(e.message).toBe('Rede 401: PV ou chave de integração recusados');
    expect(chamadas).toHaveLength(1);
  });

  it('valor zero e referência longa demais são recusados antes de chamar a Rede', async () => {
    await expect(criarPixRede(CRED, { valor: 0, idempotencia: 'pedido-a', referenciaExterna: 'a' })).rejects.toThrow('maior que zero');
    await expect(criarPixRede(CRED, { valor: 1, idempotencia: 'x'.repeat(51), referenciaExterna: 'a' })).rejects.toThrow('referência');
    expect(chamadas).toHaveLength(0);
  });
});

describe('token guardado', () => {
  it('reaproveita o token entre chamadas e pede um novo quando a Rede responde 401', async () => {
    responder(TOKEN, json(200, PENDENTE), json(200, PENDENTE), json(401, { returnCode: '26' }), json(200, { access_token: 'tk-2', expires_in: 1439 }), json(200, PAGO));
    await consultarPagamentoRede(CRED, '1');
    await consultarPagamentoRede(CRED, '1');
    const r = await consultarPagamentoRede(CRED, '1');
    expect(r.status).toBe('paid');
    const logins = chamadas.filter((c) => c.url.endsWith('/oauth2/token'));
    expect(logins).toHaveLength(2);
    expect(chamadas[chamadas.length - 1].init.headers.Authorization).toBe('Bearer tk-2');
  });

  it('chaves diferentes não dividem o token (outra loja, ou a chave trocada na tela)', async () => {
    responder(TOKEN, json(200, PENDENTE), json(200, { access_token: 'tk-outra', expires_in: 1439 }), json(200, PENDENTE));
    await consultarPagamentoRede(CRED, '1');
    await consultarPagamentoRede({ pv: CRED.pv, chave: 'outra-chave' }, '1');
    expect(chamadas[3].init.headers.Authorization).toBe('Bearer tk-outra');
  });
});

describe('consultarPagamentoRede', () => {
  it('pendente: lê o bloco qrCodeResponse e a validade do QR', async () => {
    responder(TOKEN, json(200, PENDENTE));
    const r = await consultarPagamentoRede(CRED, '40012611050404073787');
    expect(r).toEqual({ id: '40012611050404073787', status: 'pending', expiraEm: new Date('2026-11-05T04:14:06-03:00') });
  });

  it('pago: lê o bloco authorization (Approved)', async () => {
    responder(TOKEN, json(200, PAGO));
    expect((await consultarPagamentoRede(CRED, '1')).status).toBe('paid');
  });

  it('devolvido por inteiro: Canceled', async () => {
    responder(TOKEN, json(200, { authorization: { ...PAGO.authorization, status: 'Canceled' } }));
    expect((await consultarPagamentoRede(CRED, '1')).status).toBe('canceled');
  });

  it('falha da consulta lança (quem chama decide se espera)', async () => {
    responder(TOKEN, json(404, { returnCode: '78', returnMessage: 'Transaction not found.' }));
    await expect(consultarPagamentoRede(CRED, '1')).rejects.toThrow('Rede consulta 404');
  });
});

describe('reembolsarPagamentoRede', () => {
  it('parcial: manda o valor em centavos; 359 = feita', async () => {
    responder(TOKEN, json(200, { refundId: 'r1', tid: '1', returnCode: '359', returnMessage: 'Refund successful.' }));
    const r = await reembolsarPagamentoRede(CRED, '1', 2);
    expect(JSON.parse(chamadas[1].init.body)).toEqual({ amount: 200 });
    expect(chamadas[1].url).toBe('https://api.userede.com.br/erede/v2/transactions/1/refunds');
    expect(r).toEqual({ id: 'r1', status: 'done' });
  });

  it('sem valor: devolve o capturado inteiro', async () => {
    responder(TOKEN, json(200, PAGO), json(200, { refundId: 'r2', returnCode: '360', returnMessage: 'Refund processing.' }));
    const r = await reembolsarPagamentoRede(CRED, '1');
    expect(JSON.parse(chamadas[2].init.body)).toEqual({ amount: 700 });
    expect(r.status).toBe('processing');
  });

  it('já devolvido (355) lança — o chamador cai no manual', async () => {
    responder(TOKEN, json(422, { returnCode: '355', returnMessage: 'Transaction already cancelled.' }));
    await expect(reembolsarPagamentoRede(CRED, '1', 1)).rejects.toThrow('355');
  });
});

describe('validarCredencialRede e hora de Brasília', () => {
  it('"Testar conexão" só faz o login e devolve o PV', async () => {
    responder(TOKEN);
    expect(await validarCredencialRede(CRED)).toEqual({ ok: true, conta: 'PV 12345678' });
    expect(chamadas).toHaveLength(1);
  });

  it('a validade sai na hora de Brasília, sem fuso, em qualquer fuso do servidor', () => {
    expect(horaDeBrasilia(new Date('2026-11-05T02:30:00Z'))).toBe('2026-11-04T23:30:00');
    expect(horaDeBrasilia(new Date('2026-01-01T03:00:00Z'))).toBe('2026-01-01T00:00:00');
  });
});
