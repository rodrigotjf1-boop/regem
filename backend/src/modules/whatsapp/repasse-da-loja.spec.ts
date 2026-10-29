import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { repassarParaNuvem } from './repasse-da-loja';
import { conferirEmpresaDaLoja } from './whatsapp-da-loja.controller';
import { rotaDaCaixaDaLoja, rotaDaFilaDeImpressao } from '../../common/dispositivo-limite';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A CAIXA DE CONVERSAS DO WHATSAPP NO SERVIDOR DA LOJA (Fase 1 do robô): o servidor repassa para a nuvem com o token
// dele e a empresa/colaborador logado; sem a nuvem, a tela recebe um 503 legível; o erro da nuvem volta como veio.
describe('caixa de conversas no servidor da loja — repasse para a nuvem', () => {
  const antes = { api: process.env.CLOUD_API, token: process.env.SYNC_TOKEN };
  const USUARIO = { tenantId: '11111111-1111-1111-1111-111111111111', colaboradorId: '22222222-2222-2222-2222-222222222222' };
  beforeEach(() => {
    process.env.CLOUD_API = 'https://nuvem.exemplo/api/v1/';
    process.env.SYNC_TOKEN = 'token-do-servidor';
  });
  afterAll(() => {
    process.env.CLOUD_API = antes.api;
    process.env.SYNC_TOKEN = antes.token;
    if (antes.api === undefined) delete process.env.CLOUD_API;
    if (antes.token === undefined) delete process.env.SYNC_TOKEN;
  });

  function fetchFalso(status: number, corpo: unknown) {
    const chamadas: any[] = [];
    const f: any = async (url: string, init: any) => {
      chamadas.push({ url, init });
      return { ok: status >= 200 && status < 300, status, text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)) };
    };
    return { f, chamadas };
  }

  it('manda o token do servidor, a empresa e o colaborador logado; monta o endereço com a query', async () => {
    const { f, chamadas } = fetchFalso(200, [{ telefone: '5521999998888' }]);
    const r = await repassarParaNuvem(
      { metodo: 'GET', caminho: 'mensagens', query: { jids: '5521999998888', jid: undefined }, usuario: USUARIO },
      f,
    );
    expect(r).toEqual([{ telefone: '5521999998888' }]);
    expect(chamadas[0].url).toBe('https://nuvem.exemplo/api/v1/whatsapp/da-loja/mensagens?jids=5521999998888');
    expect(chamadas[0].init.headers).toMatchObject({
      'x-sync-token': 'token-do-servidor',
      'x-regem-empresa': USUARIO.tenantId,
      'x-regem-usuario': USUARIO.colaboradorId,
    });
    expect(chamadas[0].init.body).toBeUndefined();
  });

  it('POST leva o corpo em JSON', async () => {
    const { f, chamadas } = fetchFalso(201, { ok: true });
    await repassarParaNuvem({ metodo: 'POST', caminho: 'enviar', corpo: { numero: '21999998888', texto: 'oi' }, usuario: USUARIO }, f);
    expect(chamadas[0].init.method).toBe('POST');
    expect(JSON.parse(chamadas[0].init.body)).toEqual({ numero: '21999998888', texto: 'oi' });
    expect(chamadas[0].init.headers['content-type']).toBe('application/json');
  });

  it('erro da nuvem volta com o MESMO status e a mesma mensagem (a tela mostra o que a nuvem disse)', async () => {
    const { f } = fetchFalso(403, { statusCode: 403, message: 'Este servidor da loja está ligado a outra empresa' });
    const e: any = await repassarParaNuvem({ metodo: 'GET', caminho: 'conversas', usuario: USUARIO }, f).catch((x) => x);
    expect(e).toBeInstanceOf(HttpException);
    expect(e.getStatus()).toBe(403);
    expect(e.getResponse()).toMatchObject({ message: 'Este servidor da loja está ligado a outra empresa' });
  });

  it('sem internet: 503 com texto legível (o motivo vai para o log)', async () => {
    const f: any = async () => {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    };
    const e: any = await repassarParaNuvem({ metodo: 'GET', caminho: 'conversas', usuario: USUARIO }, f).catch((x) => x);
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect(String(e.message)).toContain('Sem conexão com a nuvem');
  });

  it('servidor sem CLOUD_API ou SYNC_TOKEN: 503 sem tentar a rede', async () => {
    delete process.env.SYNC_TOKEN;
    const { f, chamadas } = fetchFalso(200, []);
    await expect(repassarParaNuvem({ metodo: 'GET', caminho: 'conversas', usuario: USUARIO }, f)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(chamadas).toHaveLength(0);
  });
});

describe('caixa de conversas no servidor da loja — a nuvem', () => {
  const ctx: any = { tenantId: '11111111-1111-1111-1111-111111111111', unidadeId: null, equipamentoId: 'e', token: 't' };

  it('a empresa do colaborador logado tem de ser a do token do servidor', () => {
    expect(() => conferirEmpresaDaLoja(ctx, ctx.tenantId)).not.toThrow();
    expect(() => conferirEmpresaDaLoja(ctx, '33333333-3333-3333-3333-333333333333')).toThrow('outra empresa');
    expect(() => conferirEmpresaDaLoja(ctx, undefined)).toThrow();
    expect(() => conferirEmpresaDaLoja(undefined, ctx.tenantId)).toThrow();
  });

  it('as rotas da caixa saem do limite por IP da loja (ficam no limite por aparelho); as outras não', () => {
    expect(rotaDaCaixaDaLoja('/api/v1/whatsapp/da-loja/conversas')).toBe(true);
    expect(rotaDaCaixaDaLoja('/api/v1/whatsapp/da-loja/mensagens?jids=1')).toBe(true);
    expect(rotaDaCaixaDaLoja('/api/v1/whatsapp/conversas')).toBe(false);
    expect(rotaDaCaixaDaLoja('/api/v1/sync/pull')).toBe(false);
    expect(rotaDaFilaDeImpressao('/api/v1/whatsapp/da-loja/conversas')).toBe(false);
  });
});
