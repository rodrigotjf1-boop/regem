import { escolherNumeroDaWaba, FEATURE_TYPE_COEXISTENCIA, pedirCopiaDoApp, PEDIDOS_DE_COPIA } from './coexistencia-meta';
import { WhatsappCloudService } from './whatsapp-cloud.service';

// A coexistência no cadastro integrado da Meta (12/11/2026: a opção não aparecia no Regem — o featureType ia sempre
// vazio — e a cópia dos dados do aplicativo nunca era pedida). Os corpos conferidos contra "Onboard WhatsApp Business app
// users" (developers.facebook.com): `POST /{phone_number_id}/smb_app_data` com
// `{ "messaging_product": "whatsapp", "sync_type": "smb_app_state_sync" }` e depois `"history"` (V20).

describe('coexistência — o featureType da janela da Meta', () => {
  it('é o valor da documentação (o antigo "coexistence" não vale mais)', () => {
    expect(FEATURE_TYPE_COEXISTENCIA).toBe('whatsapp_business_app_onboarding');
  });
});

describe('coexistência — o número da conta quando o evento não traz o id', () => {
  it('na coexistência: o que está no aplicativo; um número só: ele; vários sem saber qual: nenhum', () => {
    expect(
      escolherNumeroDaWaba(
        [
          { id: '100000000000001', is_on_biz_app: false, platform_type: 'CLOUD_API' },
          { id: '100000000000002', is_on_biz_app: true, platform_type: 'CLOUD_API' },
        ],
        true,
      ),
    ).toBe('100000000000002');
    expect(escolherNumeroDaWaba([{ id: '100000000000009' }], true)).toBe('100000000000009');
    // dois números e nenhum (ou os dois) no aplicativo: ligar o errado é pior que pedir de novo
    expect(escolherNumeroDaWaba([{ id: '100000000000001' }, { id: '100000000000002' }], true)).toBe('');
    expect(
      escolherNumeroDaWaba(
        [
          { id: '100000000000001', is_on_biz_app: true },
          { id: '100000000000002', is_on_biz_app: true },
        ],
        true,
      ),
    ).toBe('');
  });

  it('fora da coexistência: o primeiro, como sempre foi; lista vazia, quebrada ou com id estranho: nenhum', () => {
    expect(escolherNumeroDaWaba([{ id: '100000000000001' }, { id: '100000000000002' }], false)).toBe('100000000000001');
    expect(escolherNumeroDaWaba([], true)).toBe('');
    expect(escolherNumeroDaWaba(null, true)).toBe('');
    expect(escolherNumeroDaWaba([{ id: '../me' }, { id: '' }], false)).toBe('');
  });
});

describe('coexistência — o pedido da cópia dos dados do aplicativo', () => {
  type Chamada = { url: string; init: { method: string; headers: Record<string, string>; body: string } };
  const respostas = (...st: number[]) => {
    const chamadas: Chamada[] = [];
    const buscar = async (url: string, init: Chamada['init']) => {
      chamadas.push({ url, init });
      const status = st[chamadas.length - 1] ?? 200;
      return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => (status === 200 ? { success: true } : { error: { message: 'Phone number is not on the WhatsApp Business app' } }),
      };
    };
    return { chamadas, buscar };
  };

  it('pede os contatos e depois as conversas, com o corpo da documentação, no número e com o token', async () => {
    const r = respostas(200, 200);
    const res = await pedirCopiaDoApp({ graph: 'https://graph.facebook.com/v25.0', phoneNumberId: '100000000000002', token: 'tok', buscar: r.buscar });
    expect(res).toEqual({ pedida: true });
    expect(r.chamadas.map((c) => [c.url, c.init.method, JSON.parse(c.init.body)])).toEqual([
      ['https://graph.facebook.com/v25.0/100000000000002/smb_app_data', 'POST', { messaging_product: 'whatsapp', sync_type: 'smb_app_state_sync' }],
      ['https://graph.facebook.com/v25.0/100000000000002/smb_app_data', 'POST', { messaging_product: 'whatsapp', sync_type: 'history' }],
    ]);
    expect(r.chamadas[0].init.headers).toMatchObject({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
    expect(PEDIDOS_DE_COPIA).toEqual(['smb_app_state_sync', 'history']);
  });

  it('a Meta recusa: para ali e devolve o motivo; sem resposta: também — nunca lança', async () => {
    const recusa = respostas(200, 400);
    const r1 = await pedirCopiaDoApp({ graph: 'https://g', phoneNumberId: '100000000000002', token: 't', buscar: recusa.buscar });
    expect(r1).toEqual({ pedida: false, motivo: 'history: Phone number is not on the WhatsApp Business app' });
    const primeira = respostas(403);
    const r2 = await pedirCopiaDoApp({ graph: 'https://g', phoneNumberId: '100000000000002', token: 't', buscar: primeira.buscar });
    expect(r2.pedida).toBe(false);
    expect(primeira.chamadas).toHaveLength(1); // não pede o histórico depois de recusar os contatos
    const caiu = await pedirCopiaDoApp({
      graph: 'https://g',
      phoneNumberId: '100000000000002',
      token: 't',
      buscar: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(caiu).toEqual({ pedida: false, motivo: 'smb_app_state_sync: sem resposta da Meta (ECONNRESET)' });
  });
});

describe('coexistência — o fim do cadastro integrado (finalizarEmbeddedSignup)', () => {
  const WABA = '200000000000001';
  const NO_APP = '100000000000002';
  const gravados: any[] = [];
  // O banco de mentira: nenhuma linha do papel ainda (insere); a semeadura dos modelos roda em 2º plano e pode falhar à
  // vontade (o serviço a ignora).
  const db: any = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    insert: () => ({ values: async (v: any) => void gravados.push(v) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
  };
  let chamadas: { url: string; metodo: string; corpo: any }[] = [];
  let smbStatus = 200;
  const tokenOriginal = process.env.WA_CLOUD_TOKEN;
  const appOriginal = process.env.WA_CLOUD_APP_ID;

  beforeEach(() => {
    chamadas = [];
    gravados.length = 0;
    smbStatus = 200;
    process.env.WA_CLOUD_TOKEN = 'token-de-teste';
    delete process.env.WA_CLOUD_APP_ID; // sem a troca do code (não muda nada aqui)
    jest.spyOn(global, 'fetch').mockImplementation(async (url: any, init: any = {}) => {
      const u = String(url);
      chamadas.push({ url: u, metodo: init.method ?? 'GET', corpo: init.body ? JSON.parse(init.body) : null });
      const resposta = (status: number, corpo: unknown) => ({ ok: status < 300, status, json: async () => corpo }) as any;
      if (u.includes(`/${WABA}/phone_numbers`)) {
        return resposta(200, {
          data: [
            { id: '100000000000001', is_on_biz_app: false, platform_type: 'CLOUD_API' },
            { id: NO_APP, is_on_biz_app: true, platform_type: 'CLOUD_API' },
          ],
        });
      }
      if (u.endsWith('/smb_app_data')) return resposta(smbStatus, smbStatus === 200 ? { success: true } : { error: { message: 'recusado pela Meta' } });
      return resposta(200, { success: true, display_phone_number: '+55 21 90000-0000' });
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (tokenOriginal === undefined) delete process.env.WA_CLOUD_TOKEN;
    else process.env.WA_CLOUD_TOKEN = tokenOriginal;
    if (appOriginal !== undefined) process.env.WA_CLOUD_APP_ID = appOriginal;
  });

  const pedidosDeCopia = () => chamadas.filter((c) => c.url.endsWith('/smb_app_data'));

  it('coexistência sem o id no evento: liga o número que está no aplicativo e pede a cópia (contatos, depois conversas)', async () => {
    const svc = new WhatsappCloudService(db);
    const r: any = await svc.finalizarEmbeddedSignup('tenant-1', { code: 'c', wabaId: WABA, papel: 'marketing', coexistence: true });
    expect(r).toMatchObject({ ok: true, papel: 'marketing', phoneNumberId: NO_APP, coexistence: true, copia: 'pedida', motivoCopia: null });
    expect(pedidosDeCopia().map((c) => [c.url.split('/').slice(-2).join('/'), c.metodo, c.corpo.sync_type])).toEqual([
      [`${NO_APP}/smb_app_data`, 'POST', 'smb_app_state_sync'],
      [`${NO_APP}/smb_app_data`, 'POST', 'history'],
    ]);
    expect(gravados[0]).toMatchObject({ papel: 'marketing', provedor: 'cloud', phoneId: NO_APP, wabaId: WABA, status: 'conectado' });
    // o número em coexistência NÃO se registra (o aplicativo já registrou)
    expect(chamadas.some((c) => c.url.endsWith('/register'))).toBe(false);
  });

  it('a Meta recusa a cópia: o cadastro fica, e a resposta diz "recusada" com o motivo (a tela avisa das 24 h)', async () => {
    smbStatus = 400;
    const r: any = await new WhatsappCloudService(db).finalizarEmbeddedSignup('tenant-1', { wabaId: WABA, papel: 'marketing', coexistence: true });
    expect(r).toMatchObject({ ok: true, copia: 'recusada', motivoCopia: 'smb_app_state_sync: recusado pela Meta' });
  });

  it('número só da API: nada de cópia, e o id do evento vale', async () => {
    const r: any = await new WhatsappCloudService(db).finalizarEmbeddedSignup('tenant-1', {
      phoneNumberId: '100000000000777',
      wabaId: WABA,
      papel: 'principal',
    });
    expect(r).toMatchObject({ ok: true, phoneNumberId: '100000000000777', coexistence: false, copia: null });
    expect(pedidosDeCopia()).toEqual([]);
  });
});
