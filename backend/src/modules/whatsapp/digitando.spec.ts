import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappService } from './whatsapp.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// "DIGITANDO…" ENQUANTO O ROBÔ PENSA (Fase 5 do robô, F1 — 30/10/2026): o cliente vê que alguém está respondendo.
// API oficial: o mesmo pedido marca a mensagem como lida e mostra o indicador (doc da Meta, "Typing indicators").
// Evolution 2.3.x: POST /chat/sendPresence/{instância} { number, presence: 'composing', delay }.
// Nas duas: dispara e segue — nunca lança, e sem ele o robô responde igual.

const PHONE = '1000000000000001';

async function esperarPendencias() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

describe('"digitando…" na API oficial', () => {
  const antes = process.env.WA_CLOUD_TOKEN;
  afterEach(() => {
    jest.restoreAllMocks();
    if (antes === undefined) delete process.env.WA_CLOUD_TOKEN;
    else process.env.WA_CLOUD_TOKEN = antes;
  });
  const svc = () => {
    const s = new WhatsappCloudService({} as any);
    (s as any).logger = { log() {}, warn() {}, debug() {} };
    return s;
  };

  it('marca como lida e mostra o indicador, no formato da Meta', async () => {
    process.env.WA_CLOUD_TOKEN = 'token-falso';
    const pedidos: any[] = [];
    jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
      pedidos.push({ url: String(url), init });
      return { ok: true, status: 200, json: async () => ({ success: true }) } as any;
    });
    (svc() as any).mostrarDigitando(PHONE, 'wamid.ABC');
    await esperarPendencias();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toMatch(new RegExp(`/${PHONE}/messages$`));
    expect(pedidos[0].init.method).toBe('POST');
    expect(JSON.parse(pedidos[0].init.body)).toEqual({
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: 'wamid.ABC',
      typing_indicator: { type: 'text' },
    });
  });

  it('sem token, sem id da mensagem ou com Phone Number ID estranho: não chama a Meta', async () => {
    const espiao = jest.spyOn(global, 'fetch' as any);
    delete process.env.WA_CLOUD_TOKEN;
    (svc() as any).mostrarDigitando(PHONE, 'wamid.ABC');
    process.env.WA_CLOUD_TOKEN = 'token-falso';
    (svc() as any).mostrarDigitando(PHONE, '');
    (svc() as any).mostrarDigitando('../outra-rota', 'wamid.ABC');
    await esperarPendencias();
    expect(espiao).not.toHaveBeenCalled();
  });

  it('a Meta fora do ar não derruba nada (a promessa não rejeita)', async () => {
    process.env.WA_CLOUD_TOKEN = 'token-falso';
    jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('rede caiu'));
    expect(() => (svc() as any).mostrarDigitando(PHONE, 'wamid.ABC')).not.toThrow();
    await esperarPendencias();
  });
});

describe('"digitando…" na Evolution', () => {
  const antes = { u: process.env.EVOLUTION_API_URL, k: process.env.EVOLUTION_API_KEY };
  afterEach(() => {
    jest.restoreAllMocks();
    for (const [nome, valor] of [
      ['EVOLUTION_API_URL', antes.u],
      ['EVOLUTION_API_KEY', antes.k],
    ] as const) {
      if (valor === undefined) delete process.env[nome];
      else process.env[nome] = valor;
    }
  });

  it('manda a presença "composing" com o prazo, pela instância', async () => {
    process.env.EVOLUTION_API_URL = 'https://evolution.exemplo/';
    process.env.EVOLUTION_API_KEY = 'chave-falsa';
    const pedidos: any[] = [];
    jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
      pedidos.push({ url: String(url), init });
      return { ok: true, status: 201, json: async () => ({}), clone() { return this; } } as any;
    });
    new WhatsappService({} as any).mostrarDigitando('Mister.ia', '5521999998888');
    await esperarPendencias();
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe('https://evolution.exemplo/chat/sendPresence/Mister.ia');
    expect(pedidos[0].init.headers.apikey).toBe('chave-falsa');
    expect(JSON.parse(pedidos[0].init.body)).toEqual({ number: '5521999998888', presence: 'composing', delay: 10000 });
  });

  it('Evolution sem configuração ou fora do ar: não lança', async () => {
    delete process.env.EVOLUTION_API_URL;
    delete process.env.EVOLUTION_API_KEY;
    expect(() => new WhatsappService({} as any).mostrarDigitando('Mister.ia', '5521999998888')).not.toThrow();
    process.env.EVOLUTION_API_URL = 'https://evolution.exemplo';
    process.env.EVOLUTION_API_KEY = 'chave-falsa';
    jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('rede caiu'));
    expect(() => new WhatsappService({} as any).mostrarDigitando('Mister.ia', '5521999998888')).not.toThrow();
    await esperarPendencias();
  });
});
