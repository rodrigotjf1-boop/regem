import * as consentimento from '../../common/consentimento-marketing';
import { PEDE_SAIDA, PEDE_VOLTA, TEXTO_SAIU, TEXTO_VOLTOU } from '../../common/consentimento-marketing';
import { WhatsappCloudService } from './whatsapp-cloud.service';
import { EvolutionEntradaService } from './evolution-entrada.service';
import { WhatsappService } from './whatsapp.service';
import { whatsappMensagem } from '../../db/schema';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O NÚMERO DE MARKETING da loja (o das campanhas, das automáticas e dos avisos de vaga) recebe a resposta SAIR/VOLTAR. Antes,
// na API oficial a mensagem a ele caía em "não vinculado" e, no Evolution, a instância de marketing nem tinha webhook: a
// pessoa respondia SAIR e continuava recebendo. Ele só envia — o robô não responde por ele. Bancos falsos, sem Postgres.

const DE = '5521999998888';
const MKT = '999000111222333';

describe('a palavra de saída e a de volta (as mesmas nas duas entradas e nos dois números)', () => {
  it('SAIR, os botões "Sair das ofertas" e "Não quero mais receber"; "cancelar" não (ERR-317)', () => {
    for (const t of ['sair', 'parar', 'stop', 'sair das ofertas', 'não quero receber', 'nao quero mais receber', 'não quero mais receber.'])
      expect([t, PEDE_SAIDA.test(t)]).toEqual([t, true]);
    for (const t of ['cancelar', 'quero sair do grupo', 'não quero mais', 'tenho interesse', 'não quero mais receber essa pizza'])
      expect([t, PEDE_SAIDA.test(t)]).toEqual([t, false]);
    expect(PEDE_VOLTA.test('voltar')).toBe(true);
    expect(PEDE_VOLTA.test('quero voltar')).toBe(false);
  });
});

describe('o número de marketing na API oficial', () => {
  function fakeDb() {
    const gravadas: any[] = [];
    const vazio = () => {
      const p: any = Promise.resolve([]);
      p.from = () => p;
      p.where = () => p;
      p.orderBy = () => p;
      p.limit = () => p;
      return p;
    };
    return {
      gravadas,
      select: () => ({ from: (_t: any) => vazio() }),
      insert: (t: any) => ({
        values: (v: any) => {
          const repetida = t === whatsappMensagem && !!v?.wamid && gravadas.some((g) => g.wamid === v.wamid);
          if (!repetida) gravadas.push(v);
          const p: any = Promise.resolve();
          p.returning = () => Promise.resolve(repetida ? [] : [{ id: `id-${gravadas.length}` }]);
          return { onConflictDoNothing: () => p };
        },
      }),
      update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
      transaction: async (fn: any) => fn({ execute: async () => ({ rows: [], rowCount: 0 }), insert: () => ({ values: async () => undefined }) }),
    } as any;
  }
  const evento = (texto: string, id = 'wamid.MKT', phoneId = MKT, tipo = 'text') => ({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: phoneId },
              contacts: [{ wa_id: DE, profile: { name: 'Maria' } }],
              messages: [
                tipo === 'button'
                  ? { from: DE, id, type: 'button', timestamp: '1756200000', button: { text: texto, payload: texto } }
                  : { from: DE, id, type: 'text', timestamp: '1756200000', text: { body: texto } },
              ],
            },
          },
        ],
      },
    ],
  });
  function montar() {
    const db = fakeDb();
    const svc = new WhatsappCloudService(db);
    (svc as any).logger = { log() {}, warn() {}, error() {}, debug() {} };
    const robo: any[] = [];
    (svc as any).encaminhar = async (m: any) => robo.push(m);
    (svc as any).lojaPeloMarketing = async (p: string) => (p === MKT ? { tenantId: 'tenant-1' } : null);
    const textos: any[] = [];
    (svc as any).enviarTexto = async (tenantId: string, para: string, texto: string, opts: any) => textos.push({ tenantId, para, texto, phoneId: opts?.phoneId });
    return { svc, db, robo, textos };
  }
  afterEach(() => jest.restoreAllMocks());

  it('SAIR tira das ofertas e confirma pelo PRÓPRIO número de marketing; o reenvio da Meta não confirma duas vezes', async () => {
    const saida = jest.spyOn(consentimento, 'registrarSaida');
    const { svc, db, robo, textos } = montar();
    await svc.processar(evento('SAIR'));
    await svc.processar(evento('SAIR'));
    expect(saida).toHaveBeenCalledTimes(1);
    expect(saida.mock.calls[0][1]).toMatchObject({ tenantId: 'tenant-1', telefone: DE, origem: 'whatsapp', motivo: 'palavra_chave' });
    expect(textos).toEqual([{ tenantId: 'tenant-1', para: DE, texto: TEXTO_SAIU, phoneId: MKT }]);
    expect(db.gravadas.map((g: any) => [g.direcao, g.texto, g.wamid])).toEqual([['entrada', 'SAIR', 'wamid.MKT']]);
    expect(robo).toHaveLength(0);
  });

  it('o botão "Não quero mais receber" (o aviso de vaga) também sai; VOLTAR volta, os dois pelo número de marketing', async () => {
    const saida = jest.spyOn(consentimento, 'registrarSaida');
    const volta = jest.spyOn(consentimento, 'registrarVolta');
    const { svc, textos } = montar();
    await svc.processar(evento('Não quero mais receber', 'wamid.B1', MKT, 'button'));
    await svc.processar(evento('voltar', 'wamid.B2'));
    expect(saida).toHaveBeenCalledTimes(1);
    expect(volta).toHaveBeenCalledTimes(1);
    expect(textos.map((t) => [t.texto, t.phoneId])).toEqual([
      [TEXTO_SAIU, MKT],
      [TEXTO_VOLTOU, MKT],
    ]);
  });

  it('o resto (pergunta, "cancelar") fica de fora: não vai ao robô, não confirma nem grava', async () => {
    const saida = jest.spyOn(consentimento, 'registrarSaida');
    const { svc, db, robo, textos } = montar();
    await svc.processar(evento('vocês entregam no centro?', 'wamid.P1'));
    await svc.processar(evento('cancelar', 'wamid.P2'));
    expect([saida.mock.calls.length, textos.length, db.gravadas.length, robo.length]).toEqual([0, 0, 0, 0]);
  });

  it('número que não é principal nem de marketing de ninguém segue "não vinculado": nada acontece', async () => {
    const saida = jest.spyOn(consentimento, 'registrarSaida');
    const { svc, textos } = montar();
    await svc.processar(evento('SAIR', 'wamid.X', '111'));
    expect([saida.mock.calls.length, textos.length]).toEqual([0, 0]);
  });

  it('a loja do número de marketing: só a oficial, da rede, e só quando é de UMA loja', async () => {
    const comLinhas = (linhas: any[]) => {
      const s = new WhatsappCloudService({ select: () => ({ from: () => ({ where: async () => linhas }) }) } as any);
      (s as any).logger = { log() {}, warn() {} };
      return s;
    };
    expect(await (comLinhas([{ tenantId: 'a' }]) as any).lojaPeloMarketing(MKT)).toEqual({ tenantId: 'a' });
    expect(await (comLinhas([{ tenantId: 'a' }, { tenantId: 'b' }]) as any).lojaPeloMarketing(MKT)).toBeNull();
    expect(await (comLinhas([]) as any).lojaPeloMarketing(MKT)).toBeNull();
    expect(await (comLinhas([{ tenantId: 'a' }]) as any).lojaPeloMarketing('')).toBeNull();
  });
});

describe('a instância de marketing no Evolution', () => {
  const LOJA = { tenantId: 't1', token: 'abc', marketingInstancia: 'loja-mkt-abc', evolutionInstancia: 'loja-abc', provedor: 'evolution', roboAtivo: true, ativo: true };
  function montar() {
    let consultas = 0;
    const db: any = {
      // 1ª consulta: a instância principal (nenhuma loja); 2ª: a de marketing (a loja).
      select: () => ({ from: () => ({ where: async () => (consultas++ % 2 === 0 ? [] : [LOJA]) }) }),
      execute: async () => ({ rows: [] }),
      transaction: async (fn: any) => fn({ execute: async () => ({ rows: [] }), insert: () => ({ values: async () => undefined }) }),
    };
    const pelaInstancia: any[] = [];
    const principal: any[] = [];
    const evolution: any = {
      enviar: async (_t: string, para: string, texto: string) => principal.push({ para, texto }),
      enviarPorInstancia: async (tenantId: string, instancia: string, para: string, texto: string) => pelaInstancia.push({ tenantId, instancia, para, texto }),
      mostrarDigitando: () => undefined,
    };
    const svc = new EvolutionEntradaService(db, evolution);
    (svc as any).logger = { log() {}, warn() {} };
    return { svc, pelaInstancia, principal };
  }
  const aviso = (texto: string, fromMe = false) => ({
    event: 'messages.upsert',
    instance: 'loja-mkt-abc',
    data: { key: { remoteJid: `${DE}@s.whatsapp.net`, fromMe, id: `ID${Math.random().toString(36).slice(2, 10)}` }, message: { conversation: texto } },
  });
  afterEach(() => jest.restoreAllMocks());

  it('SAIR e "Não quero mais receber" tiram das ofertas e confirmam pela instância de marketing; VOLTAR volta', async () => {
    const saida = jest.spyOn(consentimento, 'registrarSaida');
    const volta = jest.spyOn(consentimento, 'registrarVolta');
    const { svc, pelaInstancia, principal } = montar();
    await svc.processar(aviso('Sair'), 'loja-mkt-abc');
    await svc.processar(aviso('Não quero mais receber'), 'loja-mkt-abc');
    await svc.processar(aviso('voltar'), 'loja-mkt-abc');
    expect([saida.mock.calls.length, volta.mock.calls.length]).toEqual([2, 1]);
    expect(saida.mock.calls[0][1]).toMatchObject({ tenantId: 't1', telefone: DE, origem: 'whatsapp' });
    expect(pelaInstancia.map((p) => [p.instancia, p.texto])).toEqual([
      ['loja-mkt-abc', TEXTO_SAIU],
      ['loja-mkt-abc', TEXTO_SAIU],
      ['loja-mkt-abc', TEXTO_VOLTOU],
    ]);
    expect(principal).toHaveLength(0);
  });

  it('o que a loja mandou (fromMe) e o resto ficam de fora, sem robô', async () => {
    const saida = jest.spyOn(consentimento, 'registrarSaida');
    const robo = jest.spyOn(global, 'fetch' as any).mockImplementation(async () => ({ ok: true, status: 200 }) as any);
    const { svc, pelaInstancia } = montar();
    await svc.processar(aviso('SAIR', true), 'loja-mkt-abc');
    await svc.processar(aviso('quero um x-bacon'), 'loja-mkt-abc');
    expect([saida.mock.calls.length, pelaInstancia.length, robo.mock.calls.length]).toEqual([0, 0, 0]);
  });
});

describe('conectar o número de marketing no Evolution: o webhook só pela porta do Regem', () => {
  const antes = { r: process.env.EVOLUTION_PELO_REGEM, s: process.env.BOT_RESOLVER_SECRET, n: process.env.N8N_BOT_WEBHOOK_URL };
  afterEach(() => {
    for (const [k, v] of [['EVOLUTION_PELO_REGEM', antes.r], ['BOT_RESOLVER_SECRET', antes.s], ['N8N_BOT_WEBHOOK_URL', antes.n]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });
  async function conectar() {
    const cfg = { id: 'c1', tenantId: 't1', nomePublico: 'Burger da Praça', token: 'abcdef123', marketingInstancia: 'burger-da-praca-mkt-abcdef' };
    const db: any = {
      select: () => ({ from: () => ({ where: async () => [cfg] }) }),
      update: () => ({ set: () => ({ where: async () => undefined }) }),
    };
    const svc = new WhatsappService(db);
    const pedidos: { caminho: string; corpo: any }[] = [];
    (svc as any).req = async (caminho: string, init: any = {}) => {
      pedidos.push({ caminho, corpo: init.body ? JSON.parse(init.body) : null });
      return { ok: true, status: 200, json: async () => ({ base64: 'QR' }), text: async () => '' };
    };
    await svc.conectarMarketing('t1');
    return pedidos;
  }

  it('com a entrada pelo Regem: a instância nasce e é reapontada com o webhook assinado, só com as mensagens', async () => {
    process.env.EVOLUTION_PELO_REGEM = 'true';
    process.env.BOT_RESOLVER_SECRET = 'segredo';
    const pedidos = await conectar();
    const criar = pedidos.find((p) => p.caminho === '/instance/create')!;
    expect(criar.corpo.webhook).toMatchObject({ enabled: true, events: ['MESSAGES_UPSERT'], headers: { 'x-regem-evolution': expect.any(String) } });
    expect(criar.corpo.webhook.url).toMatch(/\/publico\/whatsapp\/evolution\/webhook$/);
    expect(pedidos.find((p) => p.caminho === '/webhook/set/burger-da-praca-mkt-abcdef')?.corpo.webhook.events).toEqual(['MESSAGES_UPSERT']);
  });

  it('pelo n8n (sem a entrada pelo Regem): sem webhook — o robô de lá responderia pelo número de marketing', async () => {
    delete process.env.EVOLUTION_PELO_REGEM;
    process.env.N8N_BOT_WEBHOOK_URL = 'https://n8n.exemplo/webhook/robo';
    const pedidos = await conectar();
    expect(pedidos.find((p) => p.caminho === '/instance/create')!.corpo.webhook).toBeUndefined();
    expect(pedidos.some((p) => p.caminho.startsWith('/webhook/set/'))).toBe(false);
  });
});
