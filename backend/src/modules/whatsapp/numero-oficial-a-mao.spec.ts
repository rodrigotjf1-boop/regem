import { WhatsappCloudService } from './whatsapp-cloud.service';
import { WhatsappNumeroService } from './whatsapp-numero.service';
import { cardapioConfig, whatsappNumero } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// Número que JÁ está na API oficial, ligado à mão (Delivery › Configurações › Robô de atendimento › Número › Oficial
// (Meta) › "avançado"). Antes, o salvar só gravava os códigos: numa conta WABA que não é a nossa (a do lojista, ou a de
// um número que entrou pelo app do RegemCast), o nosso app não ficava inscrito nela e as mensagens não chegavam ao
// Regem — robô mudo, sem aviso (30/10/2026). Agora o servidor confere na Meta e inscreve o app antes de gravar.

const PHONE = '1000000000000001';
const WABA = '2000000000000002';

type Resposta = { status?: number; corpo: any };

function fetchFalso(rotas: (url: string, init: any) => Resposta | undefined) {
  const pedidos: { url: string; metodo: string }[] = [];
  const espiao = jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
    const u = String(url);
    pedidos.push({ url: u, metodo: String(init?.method ?? 'GET') });
    const r = rotas(u, init) ?? { status: 404, corpo: { error: { message: 'rota falsa sem resposta' } } };
    const status = r.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => r.corpo,
      text: async () => JSON.stringify(r.corpo),
    } as any;
  });
  return { pedidos, espiao };
}

const metaOk = (url: string): Resposta | undefined => {
  if (url.includes(`/${PHONE}?fields=`))
    return { corpo: { display_phone_number: '+55 21 90000-0000', verified_name: 'Mister Teste', code_verification_status: 'VERIFIED' } };
  if (url.includes(`/${WABA}/phone_numbers`)) return { corpo: { data: [{ id: '999' }, { id: PHONE }] } };
  if (url.includes(`/${WABA}/subscribed_apps`)) return { corpo: { success: true } };
  return undefined;
};

// Banco falso do serviço da oficial: a 1ª consulta é a de verificarNumero (donos do número, qualquer loja), a 2ª a de
// "Principal de OUTRA loja" — devolve o que o teste mandar.
function cloudCom(outraLoja: any[] = []) {
  let n = 0;
  const db: any = {
    select: () => ({
      from: () => ({
        where: () => {
          n++;
          return Promise.resolve(n === 1 ? [] : outraLoja);
        },
      }),
    }),
  };
  return new WhatsappCloudService(db);
}

describe('WhatsappCloudService.conectarNumeroExistente — número já na oficial, ligado à mão', () => {
  beforeEach(() => {
    process.env.WA_CLOUD_TOKEN = 'token-falso';
  });
  afterEach(() => jest.restoreAllMocks());

  it('confere o número, confere que é da conta e inscreve o nosso app nela', async () => {
    const { pedidos } = fetchFalso(metaOk);
    const r = await cloudCom().conectarNumeroExistente('tenant-1', 'principal', PHONE, WABA);
    expect(r).toEqual({ numero: '+55 21 90000-0000', nomeExibicao: 'Mister Teste', verificado: true });
    expect(pedidos.map((p) => `${p.metodo} ${p.url.replace(/^https:\/\/graph\.facebook\.com\/v[0-9.]+/, '')}`)).toEqual([
      `GET /${PHONE}?fields=display_phone_number,verified_name,quality_rating,code_verification_status`,
      `GET /${WABA}/phone_numbers?fields=id`,
      `POST /${WABA}/subscribed_apps`,
    ]);
  });

  it('número que não é daquela conta: recusa e NÃO inscreve o app em conta errada', async () => {
    const { pedidos } = fetchFalso((url) =>
      url.includes('/phone_numbers') ? { corpo: { data: [{ id: '999' }] } } : metaOk(url),
    );
    await expect(cloudCom().conectarNumeroExistente('tenant-1', 'principal', PHONE, WABA)).rejects.toThrow(
      'não é da conta WABA',
    );
    expect(pedidos.some((p) => p.url.includes('subscribed_apps'))).toBe(false);
  });

  it('a Meta recusa a inscrição: o motivo dela volta na mensagem', async () => {
    fetchFalso((url) =>
      url.includes('subscribed_apps')
        ? { status: 403, corpo: { error: { message: '(#200) Permissions error', code: 200 } } }
        : metaOk(url),
    );
    await expect(cloudCom().conectarNumeroExistente('tenant-1', 'principal', PHONE, WABA)).rejects.toThrow(
      /não ligou o Regem a essa conta WABA \(403\).*Permissions error/,
    );
  });

  it('a Meta responde 200 sem success: também é recusa', async () => {
    fetchFalso((url) => (url.includes('subscribed_apps') ? { corpo: { success: false } } : metaOk(url)));
    await expect(cloudCom().conectarNumeroExistente('tenant-1', 'principal', PHONE, WABA)).rejects.toThrow(
      'não ligou o Regem',
    );
  });

  it('nosso token não alcança o número: recusa com o motivo, antes de mexer na conta', async () => {
    const { pedidos } = fetchFalso((url) =>
      url.includes(`/${PHONE}?`) ? { status: 400, corpo: { error: { message: 'Unsupported get request' } } } : metaOk(url),
    );
    await expect(cloudCom().conectarNumeroExistente('tenant-1', 'principal', PHONE, WABA)).rejects.toThrow(
      /Não consegui conferir esse número na Meta \(400\).*Unsupported get request/,
    );
    expect(pedidos).toHaveLength(1);
  });

  it('Principal que já é de OUTRA loja: recusa sem tocar na conta WABA', async () => {
    const { pedidos } = fetchFalso(metaOk);
    await expect(
      cloudCom([{ nome: 'Outra Loja' }]).conectarNumeroExistente('tenant-1', 'principal', PHONE, WABA),
    ).rejects.toThrow('Principal de outra loja (Outra Loja)');
    expect(pedidos.some((p) => p.url.includes(WABA))).toBe(false);
  });

  it('WABA ID vazio ou com letras: recusa antes de chamar a Meta', async () => {
    const { pedidos } = fetchFalso(metaOk);
    await expect(cloudCom().conectarNumeroExistente('tenant-1', 'principal', PHONE, '')).rejects.toThrow('WABA ID');
    await expect(cloudCom().conectarNumeroExistente('tenant-1', 'principal', PHONE, 'abc')).rejects.toThrow('WABA ID');
    expect(pedidos).toHaveLength(0);
  });
});

// Banco falso do serviço de números: guarda o que foi gravado em cada tabela.
function numeroCom(cloud: any) {
  const gravado: { tabela: string; dados: any }[] = [];
  const nome = (t: any) => (t === whatsappNumero ? 'whatsapp_numero' : t === cardapioConfig ? 'cardapio_config' : '?');
  const db: any = {
    select: () => ({
      from: (t: any) => ({
        where: () => Promise.resolve(t === cardapioConfig ? [{ id: 'cfg-1', tenantId: 'tenant-1', provedor: 'evolution' }] : []),
      }),
    }),
    insert: (t: any) => ({
      values: (v: any) => {
        gravado.push({ tabela: nome(t), dados: v });
        return Promise.resolve();
      },
    }),
    update: (t: any) => ({
      set: (s: any) => ({
        where: () => {
          gravado.push({ tabela: nome(t), dados: s });
          return Promise.resolve();
        },
      }),
    }),
  };
  return { svc: new WhatsappNumeroService(db, cloud), gravado };
}

describe('WhatsappNumeroService.salvarNumero — oficial só grava o que a Meta confirmou', () => {
  it('oficial com os dois códigos: confere/inscreve e grava conectado, com o número lido na Meta', async () => {
    const conectar = jest.fn(async () => ({ numero: '+55 21 90000-0000', nomeExibicao: 'Mister Teste', verificado: true }));
    const { svc, gravado } = numeroCom({ conectarNumeroExistente: conectar });
    await svc.salvarNumero('tenant-1', 'principal', { provedor: 'cloud', phoneId: ` ${PHONE} `, wabaId: WABA, termoAceito: 'v1' });
    expect(conectar).toHaveBeenCalledWith('tenant-1', 'principal', PHONE, WABA);
    const linha = gravado.find((g) => g.tabela === 'whatsapp_numero')!.dados;
    expect(linha).toMatchObject({ provedor: 'cloud', phoneId: PHONE, wabaId: WABA, numero: '5521900000000', status: 'conectado', verificado: true });
    const loja = gravado.find((g) => g.tabela === 'cardapio_config')!.dados;
    expect(loja).toMatchObject({ provedor: 'cloud', waCloudPhoneId: PHONE, waCloudWabaId: WABA, waCloudNumero: '5521900000000' });
  });

  it('o número digitado na tela vale sobre o da Meta', async () => {
    const conectar = jest.fn(async () => ({ numero: '+55 21 90000-0000', nomeExibicao: null, verificado: false }));
    const { svc, gravado } = numeroCom({ conectarNumeroExistente: conectar });
    await svc.salvarNumero('tenant-1', 'marketing', { provedor: 'cloud', phoneId: PHONE, wabaId: WABA, numero: '(21) 99999-0000' });
    expect(gravado.find((g) => g.tabela === 'whatsapp_numero')!.dados).toMatchObject({ numero: '21999990000' });
  });

  it('oficial sem o WABA ID (ou sem o Phone Number ID): recusa e não grava nada', async () => {
    const conectar = jest.fn();
    const { svc, gravado } = numeroCom({ conectarNumeroExistente: conectar });
    await expect(svc.salvarNumero('tenant-1', 'principal', { provedor: 'cloud', phoneId: PHONE })).rejects.toThrow('Conectar com a Meta');
    await expect(svc.salvarNumero('tenant-1', 'principal', { provedor: 'cloud', wabaId: WABA })).rejects.toThrow('Conectar com a Meta');
    expect(conectar).not.toHaveBeenCalled();
    expect(gravado).toHaveLength(0);
  });

  it('a Meta recusa: o erro dela sobe e nada é gravado', async () => {
    const conectar = jest.fn(async () => {
      throw new Error('A Meta não ligou o Regem a essa conta WABA (403)');
    });
    const { svc, gravado } = numeroCom({ conectarNumeroExistente: conectar });
    await expect(svc.salvarNumero('tenant-1', 'principal', { provedor: 'cloud', phoneId: PHONE, wabaId: WABA })).rejects.toThrow('403');
    expect(gravado).toHaveLength(0);
  });

  it('Evolution (QR): segue como antes, sem chamar a Meta', async () => {
    const conectar = jest.fn();
    const { svc, gravado } = numeroCom({ conectarNumeroExistente: conectar });
    await svc.salvarNumero('tenant-1', 'principal', { provedor: 'evolution', numero: '5521900000000' });
    expect(conectar).not.toHaveBeenCalled();
    const linha = gravado.find((g) => g.tabela === 'whatsapp_numero')!.dados;
    expect(linha).toMatchObject({ provedor: 'evolution', phoneId: null, wabaId: null });
    expect(linha.status).toBe('desconectado'); // linha nova da Evolution: o selo vem da conexão por QR
  });
});
