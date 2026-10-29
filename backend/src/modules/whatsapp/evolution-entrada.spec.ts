import { createHmac } from 'node:crypto';
import { PgDialect } from 'drizzle-orm/pg-core';
import { EvolutionEntradaService, lerMensagemEvolution, telefoneDaConversa } from './evolution-entrada.service';
import { esquecerEnvios, lembrarEnvio } from './evolution-envios';
import { enderecoDoRobo, entregarAoRobo } from './entregar-ao-robo';
import { assinaturaDaInstancia, assinaturaDaInstanciaOk, assinarParaORobo } from '../../common/segredo-robo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A ENTRADA PELA EVOLUTION PASSANDO PELO REGEM (Fase 2): as mesmas travas da API oficial, e a pausa quando alguém
// responde pelo celular da loja (fromMe que o Regem não mandou).
const SENHA = 'senha-do-robo';
const TEL = '5521999998888';
const dialeto = new PgDialect();

function montar(cfg: any) {
  const sqls: string[] = [];
  const enviados: any[] = [];
  const db: any = {
    select: () => ({ from: () => ({ where: async () => (cfg ? [cfg] : []) }) }),
    execute: async (q: any) => {
      let texto = '';
      try {
        texto = dialeto.sqlToQuery(q).sql;
      } catch (e: any) {
        texto = `ERRO AO LER O SQL: ${e?.message ?? e}`;
      }
      sqls.push(texto);
      return { rows: [] };
    },
    transaction: async (fn: any) => fn({ execute: async () => ({ rows: [] }), insert: () => ({ values: async () => undefined }) }),
  };
  const evolution: any = { enviar: async (_t: string, para: string, texto: string) => enviados.push({ para, texto }) };
  const svc = new EvolutionEntradaService(db, evolution);
  (svc as any).logger = { log() {}, warn() {} };
  return { svc, sqls, enviados };
}

const LOJA = { tenantId: 't1', token: 'abc', nomePublico: 'Mister', aberto: true, ativo: true, roboAtivo: true, provedor: 'evolution', roboPausados: [] };
const aviso = (data: any) => ({ event: 'messages.upsert', instance: 'mister-abc123', data });
const msg = (texto: string, extra: any = {}) => {
  const { key, ...resto } = extra;
  return {
    key: { remoteJid: `${TEL}@s.whatsapp.net`, fromMe: false, id: `ID${Math.random().toString(36).slice(2, 10)}`, ...key },
    pushName: 'Maria',
    message: { conversation: texto },
    messageTimestamp: 1761700000,
    ...resto,
  };
};

describe('entrada pela Evolution — o que a mensagem é', () => {
  it('texto, legenda, áudio, voto da enquete e opção tocada', () => {
    expect(lerMensagemEvolution({ message: { conversation: 'oi' } })).toEqual({ tipo: 'text', texto: 'oi', opcaoId: null });
    expect(lerMensagemEvolution({ message: { extendedTextMessage: { text: 'link' } } }).texto).toBe('link');
    expect(lerMensagemEvolution({ message: { audioMessage: {} } })).toEqual({ tipo: 'audio', texto: '', opcaoId: null });
    expect(lerMensagemEvolution({ message: { imageMessage: { caption: 'esse' } } })).toMatchObject({ tipo: 'image', texto: 'esse' });
    expect(
      lerMensagemEvolution({ message: { pollUpdateMessage: { vote: { selectedOptions: [{ name: 'Ver cardápio' }] } } } }),
    ).toEqual({ tipo: 'poll', texto: 'Ver cardápio', opcaoId: null });
    expect(
      lerMensagemEvolution({ message: { listResponseMessage: { title: 'Status', singleSelectReply: { selectedRowId: 'st' } } } }),
    ).toEqual({ tipo: 'interactive', texto: 'Status', opcaoId: 'st' });
  });

  it('telefone: o do jid; @lid pelo número real; grupo e status ficam de fora', () => {
    expect(telefoneDaConversa({ remoteJid: `${TEL}@s.whatsapp.net` })).toBe(TEL);
    expect(telefoneDaConversa({ remoteJid: '1234@lid', remoteJidAlt: `${TEL}@s.whatsapp.net` })).toBe(TEL);
    expect(telefoneDaConversa({ remoteJid: '1234@lid' })).toBe('');
    expect(telefoneDaConversa({ remoteJid: '1203@g.us' })).toBe('');
    expect(telefoneDaConversa({ remoteJid: 'status@broadcast' })).toBe('');
  });
});

describe('entrada pela Evolution — as travas', () => {
  const antes = { s: process.env.BOT_RESOLVER_SECRET, u: process.env.N8N_ROBO_WEBHOOK_URL };
  let entregas: any[];
  let espiao: jest.SpyInstance;
  beforeEach(() => {
    process.env.BOT_RESOLVER_SECRET = SENHA;
    process.env.N8N_ROBO_WEBHOOK_URL = 'https://n8n.exemplo/webhook/robo';
    process.env.ROBO_JUNTAR_MS = '0'; // aqui cada mensagem vai na hora; a junção tem o teste dela

    entregas = [];
    espiao = jest.spyOn(global, 'fetch' as any).mockImplementation(async (url: any, init: any) => {
      entregas.push({ url, headers: init.headers, corpo: JSON.parse(init.body) });
      return { ok: true, status: 200 } as any;
    });
    esquecerEnvios();
  });
  afterEach(() => {
    espiao.mockRestore();
    jest.useRealTimers();
  });
  afterAll(() => {
    delete process.env.ROBO_JUNTAR_MS;
    process.env.BOT_RESOLVER_SECRET = antes.s;
    process.env.N8N_ROBO_WEBHOOK_URL = antes.u;
    if (antes.s === undefined) delete process.env.BOT_RESOLVER_SECRET;
    if (antes.u === undefined) delete process.env.N8N_ROBO_WEBHOOK_URL;
  });

  it('mensagem do cliente vai ao robô no formato único, assinada', async () => {
    const { svc } = montar(LOJA);
    await svc.processar(aviso(msg('tem x-bacon?')), 'mister-abc123');
    expect(entregas).toHaveLength(1);
    expect(entregas[0].corpo).toMatchObject({
      provedor: 'evolution',
      tenantId: 't1',
      instancia: 'mister-abc123',
      phoneNumberId: null,
      de: TEL,
      nome: 'Maria',
      tipo: 'text',
      texto: 'tem x-bacon?',
      cardapioToken: 'abc',
    });
    const assinatura = createHmac('sha256', SENHA).update(JSON.stringify(entregas[0].corpo)).digest('hex');
    expect(entregas[0].headers['x-regem-assinatura']).toBe(`sha256=${assinatura}`);
  });

  it('a mesma mensagem reenviada pela Evolution não vai ao robô de novo', async () => {
    const { svc } = montar(LOJA);
    const m = msg('oi');
    await svc.processar(aviso(m), 'mister-abc123');
    await svc.processar(aviso(m), 'mister-abc123');
    expect(entregas).toHaveLength(1);
  });

  it('áudio leva o id para o robô baixar', async () => {
    const { svc } = montar(LOJA);
    await svc.processar(aviso({ ...msg(''), message: { audioMessage: {} } }), 'mister-abc123');
    expect(entregas[0].corpo).toMatchObject({ tipo: 'audio', midiaId: entregas[0].corpo.mensagemId, jid: `${TEL}@s.whatsapp.net` });
  });

  it('SAIR tira das ofertas e confirma, sem ir ao robô; "cancelar" vai ao robô (ERR-317)', async () => {
    const a = montar(LOJA);
    await a.svc.processar(aviso(msg('Sair')), 'mister-abc123');
    expect(a.enviados[0].texto).toContain('não vai mais receber ofertas');
    expect(entregas).toHaveLength(0);
    await a.svc.processar(aviso(msg('cancelar')), 'mister-abc123');
    expect(entregas).toHaveLength(1);
  });

  it('robô desligado, loja na API oficial ou conversa pausada: não vai ao robô', async () => {
    for (const cfg of [{ ...LOJA, roboAtivo: false }, { ...LOJA, provedor: 'cloud' }, { ...LOJA, roboPausados: [TEL] }]) {
      const { svc } = montar(cfg);
      await svc.processar(aviso(msg('oi')), 'mister-abc123');
    }
    expect(entregas).toHaveLength(0);
  });

  it('alguém respondeu PELO CELULAR (fromMe que o Regem não mandou): o robô pausa nesta conversa', async () => {
    jest.useFakeTimers();
    const { svc, sqls } = montar(LOJA);
    await svc.processar(aviso(msg('já te atendo', { key: { fromMe: true, id: 'DOCELULAR1' } })), 'mister-abc123');
    expect(entregas).toHaveLength(0);
    await jest.advanceTimersByTimeAsync(4500);
    for (let i = 0; i < 20; i++) await Promise.resolve(); // a pausa encadeia três consultas
    expect(sqls).toEqual(expect.arrayContaining([expect.stringMatching(/insert into robo_pausa/i)]));
  });

  it('fromMe que o PRÓPRIO Regem mandou (robô, caixa, campanha): não pausa', async () => {
    jest.useFakeTimers();
    const { svc, sqls } = montar(LOJA);
    lembrarEnvio('DOREGEM1');
    await svc.processar(aviso(msg('resposta do robô', { key: { fromMe: true, id: 'DOREGEM1' } })), 'mister-abc123');
    await jest.advanceTimersByTimeAsync(4500);
    expect(sqls.some((s) => /insert into robo_pausa/i.test(s))).toBe(false);
  });
});

describe('assinaturas', () => {
  const antes = process.env.BOT_RESOLVER_SECRET;
  afterAll(() => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
  });

  it('cada instância tem a sua; sem a senha do robô nada passa', () => {
    process.env.BOT_RESOLVER_SECRET = SENHA;
    const a = assinaturaDaInstancia('loja-a');
    expect(a).toHaveLength(64);
    expect(assinaturaDaInstancia('loja-b')).not.toBe(a);
    expect(assinaturaDaInstanciaOk('loja-a', a)).toBe(true);
    expect(assinaturaDaInstanciaOk('loja-b', a)).toBe(false);
    expect(assinarParaORobo('{}')).toMatch(/^sha256=[0-9a-f]{64}$/);
    delete process.env.BOT_RESOLVER_SECRET;
    expect(assinaturaDaInstancia('loja-a')).toBe('');
    expect(assinaturaDaInstanciaOk('loja-a', '')).toBe(false);
  });

  it('endereço do robô: o fluxo novo para as duas vias; a oficial cai no antigo enquanto não houver o novo', async () => {
    const env = { n: process.env.N8N_ROBO_WEBHOOK_URL, c: process.env.N8N_BOT_CLOUD_WEBHOOK_URL };
    delete process.env.N8N_ROBO_WEBHOOK_URL;
    process.env.N8N_BOT_CLOUD_WEBHOOK_URL = 'https://antigo/cloud';
    expect(enderecoDoRobo('cloud')).toBe('https://antigo/cloud');
    expect(enderecoDoRobo('evolution')).toBe('');
    expect(await entregarAoRobo({ provedor: 'evolution' })).toBe(false); // sem endereço: não tenta
    process.env.N8N_ROBO_WEBHOOK_URL = 'https://novo/robo';
    expect(enderecoDoRobo('evolution')).toBe('https://novo/robo');
    expect(enderecoDoRobo('cloud')).toBe('https://novo/robo');
    process.env.N8N_ROBO_WEBHOOK_URL = env.n;
    process.env.N8N_BOT_CLOUD_WEBHOOK_URL = env.c;
    if (env.n === undefined) delete process.env.N8N_ROBO_WEBHOOK_URL;
    if (env.c === undefined) delete process.env.N8N_BOT_CLOUD_WEBHOOK_URL;
  });
});
