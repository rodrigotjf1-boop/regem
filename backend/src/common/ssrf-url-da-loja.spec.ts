import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { buscarUrlPublica, urlPublicaSegura } from './ssrf-guard';
import { ClienteService } from '../modules/cliente/cliente.service';
import { DesligamentoService } from '../modules/desligamento/desligamento.service';
import { OpenDeliveryService } from '../modules/integracoes/open-delivery/open-delivery.service';
import { WhatsappCloudService } from '../modules/whatsapp/whatsapp-cloud.service';
import { gerarCardapioPdf } from '../modules/whatsapp/cardapio-pdf';

/* eslint-disable @typescript-eslint/no-explicit-any */
// Endereço que a LOJA informa (webhook do n8n, base do Open Delivery, foto do produto, imagem da
// campanha) nunca leva a nuvem para a rede interna: a trava `urlPublicaSegura` vale em TODO caminho que
// chama esse endereço — inclusive o "testar webhook", que devolvia ao presidente o que o destino
// respondeu — e um redirecionamento do destino não escapa dela.
//
// O "destino interno" é um servidor HTTP de verdade em 127.0.0.1: o teste prova que ele NÃO recebeu nada.

let interno: Server;
let urlInterna = '';
let acessos = 0;

beforeAll(async () => {
  interno = createServer((req, res) => {
    acessos++;
    res.writeHead(200, { 'content-type': 'image/png' });
    res.end('segredo-da-rede-interna');
  });
  await new Promise<void>((ok) => interno.listen(0, '127.0.0.1', () => ok()));
  urlInterna = `http://127.0.0.1:${(interno.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((ok) => interno.close(() => ok()));
});
beforeEach(() => {
  acessos = 0;
});
afterEach(() => {
  jest.restoreAllMocks();
});

// Endereço público escrito como IP (a trava não precisa de DNS) — o fetch é simulado nestes casos.
const PUBLICO = 'http://93.184.216.34';

describe('a trava anti-SSRF', () => {
  it('recusa endereço interno em qualquer forma (loopback, metadata, privado, nomes locais)', async () => {
    for (const u of [
      `${urlInterna}/hook`,
      'http://localhost/x',
      'http://169.254.169.254/latest/meta-data',
      'http://10.0.0.5/',
      'http://192.168.0.10:3001/',
      'http://0x7f.1/', // o leitor de URL normaliza para 127.0.0.1
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://servidor.local/',
      'file:///etc/passwd',
    ]) {
      expect([u, await urlPublicaSegura(u)]).toEqual([u, false]);
    }
    expect(await urlPublicaSegura(`${PUBLICO}/hook`)).toBe(true);
  });

  it('buscarUrlPublica: endereço interno não é buscado', async () => {
    expect(await buscarUrlPublica(`${urlInterna}/foto.png`)).toBeNull();
    expect(acessos).toBe(0);
  });

  it('buscarUrlPublica: o redirecionamento para a rede interna NÃO é seguido; para outro público, é', async () => {
    const fetchSimulado = jest.spyOn(globalThis, 'fetch').mockImplementation(async (url: any, init: any) => {
      expect(init?.redirect).toBe('manual'); // nunca deixa o fetch seguir sozinho
      const u = String(url);
      if (u === `${PUBLICO}/para-dentro`)
        return new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
      if (u === `${PUBLICO}/para-fora`)
        return new Response(null, { status: 301, headers: { location: '/foto-certa.png' } });
      if (u === `${PUBLICO}/foto-certa.png`) return new Response('png', { status: 200 });
      throw new Error(`não devia buscar ${u}`);
    });
    expect(await buscarUrlPublica(`${PUBLICO}/para-dentro`)).toBeNull();
    expect(fetchSimulado).toHaveBeenCalledTimes(1);

    fetchSimulado.mockClear();
    const r = await buscarUrlPublica(`${PUBLICO}/para-fora`);
    expect(r?.status).toBe(200);
    expect(fetchSimulado.mock.calls.map((c) => String(c[0]))).toEqual([`${PUBLICO}/para-fora`, `${PUBLICO}/foto-certa.png`]);
  });
});

describe('os caminhos que chamam o endereço da loja', () => {
  it('testar webhook do n8n: endereço interno é recusado, sem chamar e sem devolver resposta', async () => {
    const svc = new ClienteService({} as any, {} as any, {} as any);
    jest.spyOn(svc as any, 'resolverWebhook').mockResolvedValue({ url: `${urlInterna}/webhook/otp` });
    jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
    const r: any = await svc.testarWebhook('t1');
    expect(acessos).toBe(0);
    expect(r).toEqual({ configurado: true, ok: false, erro: expect.stringMatching(/bloqueado/) });
    expect(r).not.toHaveProperty('resposta');
  });

  it('webhook do n8n (OTP e eventos) e o aviso do contador não seguem redirecionamento', async () => {
    const vistos: any[] = [];
    jest.spyOn(globalThis, 'fetch').mockImplementation(async (_u: any, init: any) => {
      vistos.push(init?.redirect);
      return new Response('ok', { status: 200 });
    });
    const cli = new ClienteService({} as any, {} as any, {} as any);
    jest.spyOn((cli as any).logger, 'log').mockImplementation(() => undefined);
    expect(await (cli as any).dispararWebhook(`${PUBLICO}/webhook/otp`, { evento: 'otp' })).toBe(true);

    const consulta = { select: () => ({ from: () => ({ where: async () => [{ ativo: true, merchantId: `${PUBLICO}/webhook/ponto`, clientSecret: null }] }) }) };
    const des = new DesligamentoService(consulta as any, {} as any, {} as any);
    expect(await (des as any).enviarPontoContador('t1', { whatsapp: '21999999999', nome: 'Contador' }, { id: 'c1', nome: 'Ana' }, '2026-10-01', '2026-10-15')).toBe(true);

    expect(vistos).toEqual(['manual', 'manual']);
  });

  it('aviso ao contador: n8n com endereço interno não é chamado', async () => {
    const consulta = { select: () => ({ from: () => ({ where: async () => [{ ativo: true, merchantId: `${urlInterna}/webhook/ponto`, clientSecret: null }] }) }) };
    const des = new DesligamentoService(consulta as any, {} as any, {} as any);
    expect(await (des as any).enviarPontoContador('t1', { whatsapp: '21999999999', nome: 'Contador' }, { id: 'c1', nome: 'Ana' }, '2026-10-01', '2026-10-15')).toBe(false);
    expect(acessos).toBe(0);
  });

  it('Open Delivery: base digitada pela loja apontando para dentro não é chamada (nem o token)', async () => {
    const od = new OpenDeliveryService({} as any);
    jest.spyOn((od as any).logger, 'warn').mockImplementation(() => undefined);
    const ig = { id: 'i1', tenantId: 't1', unidadeId: null, canal: 'open_delivery', baseUrl: urlInterna, clientId: 'a', clientSecret: 'b', token: null, config: {} };
    await expect(od.polling(ig as any)).rejects.toThrow(/bloqueado/);
    expect(acessos).toBe(0);
  });

  it('imagem do card de campanha e fotos do cardápio em PDF: endereço interno não é baixado', async () => {
    const antes = process.env.WA_CLOUD_APP_ID;
    process.env.WA_CLOUD_APP_ID = 'app-teste';
    try {
      const wa = new WhatsappCloudService({} as any);
      await expect((wa as any).uploadMidiaHandle(`${urlInterna}/card.png`)).rejects.toThrow('Não consegui baixar a imagem do card.');
    } finally {
      if (antes === undefined) delete process.env.WA_CLOUD_APP_ID;
      else process.env.WA_CLOUD_APP_ID = antes;
    }
    const pdf = await gerarCardapioPdf({ nome: 'Loja', logoUrl: `${urlInterna}/logo.png` }, [
      { nome: 'Lanches', itens: [{ nome: 'X-tudo', precoVenda: 20, imagemUrl: `${urlInterna}/x.png` }] },
    ]);
    expect(pdf.length).toBeGreaterThan(0);
    expect(acessos).toBe(0);
  });
});
