import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { RoboRespostaService, menuNumerado } from './robo-resposta.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A RESPOSTA DO ROBÔ (Fase 2): uma porta para as duas vias. O teste prova as travas (senha, provedor, robô ligado,
// conversa pausada) e o COMO de cada via: botões/lista na API oficial, menu numerado ou enquete na Evolution, voz.
const SENHA = 'senha-do-robo';
const TEL = '5521999998888';

function montar(cfg: any) {
  const chamadas: any[] = [];
  const db: any = {
    select: () => ({ from: () => ({ where: async () => (cfg ? [cfg] : []) }) }),
    execute: async () => ({ rows: [] }), // robo-pausa: sem pausa nem chamado
  };
  const evolution: any = {
    lojaDoRobo: async () => (cfg ? { tenantId: cfg.tenantId } : null),
    enviar: async (...a: any[]) => chamadas.push(['evo.texto', ...a.slice(1)]),
    enviarEnquete: async (...a: any[]) => chamadas.push(['evo.enquete', ...a.slice(1)]),
    enviarAudio: async (...a: any[]) => chamadas.push(['evo.voz', a[1]]),
  };
  const cloud: any = {
    enviarTexto: async (...a: any[]) => chamadas.push(['cloud.texto', ...a.slice(1)]),
    enviarOpcoes: async (...a: any[]) => chamadas.push(['cloud.opcoes', a[1], a[2], a[3].length]),
    enviarVoz: async (...a: any[]) => chamadas.push(['cloud.voz', a[1], a[3]]),
  };
  const svc = new RoboRespostaService(db, evolution, cloud);
  (svc as any).logger = { log() {}, warn() {} };
  return { svc, chamadas };
}

const LOJA_EVO = { tenantId: 't1', provedor: 'evolution', roboAtivo: true, ativo: true, roboPausados: [] };
const LOJA_CLOUD = { ...LOJA_EVO, provedor: 'cloud' };
const ops = (n: number) => Array.from({ length: n }, (_, i) => ({ titulo: `Opção ${i + 1}` }));

describe('resposta do robô — travas', () => {
  const antes = process.env.BOT_RESOLVER_SECRET;
  beforeAll(() => (process.env.BOT_RESOLVER_SECRET = SENHA));
  afterAll(() => {
    if (antes === undefined) delete process.env.BOT_RESOLVER_SECRET;
    else process.env.BOT_RESOLVER_SECRET = antes;
  });

  it('sem a senha do robô: 401', async () => {
    const { svc } = montar(LOJA_EVO);
    await expect(svc.responder('chute', { instancia: 'i', para: TEL, texto: 'oi' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a via tem de ser a da loja (loja na oficial não responde pela Evolution)', async () => {
    const { svc, chamadas } = montar(LOJA_CLOUD);
    await expect(svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'oi' })).rejects.toBeInstanceOf(BadRequestException);
    expect(chamadas).toHaveLength(0);
  });

  it('robô desligado ou conversa pausada: nada sai, e diz o motivo', async () => {
    const off = montar({ ...LOJA_EVO, roboAtivo: false });
    expect(await off.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'oi' })).toEqual({ ok: true, enviado: false, motivo: 'robo_desligado' });
    const pausada = montar({ ...LOJA_EVO, roboPausados: [TEL] });
    expect(await pausada.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'oi' })).toEqual({
      ok: true,
      enviado: false,
      motivo: 'conversa_pausada',
    });
    expect(off.chamadas).toHaveLength(0);
    expect(pausada.chamadas).toHaveLength(0);
  });

  it('nada para enviar: 400', async () => {
    const { svc } = montar(LOJA_EVO);
    await expect(svc.responder(SENHA, { instancia: 'i', para: TEL })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('resposta do robô — como cada via mostra', () => {
  beforeAll(() => (process.env.BOT_RESOLVER_SECRET = SENHA));

  it('API oficial: até 10 opções vão como mensagem de toque (botões/lista); mais que 10, menu numerado em texto', async () => {
    const a = montar(LOJA_CLOUD);
    expect(await a.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'O que deseja?', opcoes: ops(2) })).toMatchObject({
      enviado: true,
      enviados: ['botoes'],
    });
    expect(a.chamadas[0]).toEqual(['cloud.opcoes', TEL, 'O que deseja?', 2]);
    const b = montar(LOJA_CLOUD);
    expect((await b.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'Escolha', opcoes: ops(7) })).enviados).toEqual(['lista']);
    const c = montar(LOJA_CLOUD);
    expect((await c.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'Escolha', opcoes: ops(11) })).enviados).toEqual([
      'menu_numerado',
    ]);
    expect(c.chamadas[0][0]).toBe('cloud.texto');
    expect(c.chamadas[0][2]).toContain('11) Opção 11');
  });

  it('Evolution: menu numerado por padrão; enquete quando pedido (2 a 12 opções)', async () => {
    const a = montar(LOJA_EVO);
    await a.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'O que deseja?', opcoes: ops(3) });
    expect(a.chamadas[0][0]).toBe('evo.texto');
    expect(a.chamadas[0][2]).toBe('O que deseja?\n\n1) Opção 1\n2) Opção 2\n3) Opção 3\n\nResponda com o número da opção.');
    const b = montar(LOJA_EVO);
    await b.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'O que deseja?', opcoes: ops(3), opcoesComo: 'enquete' });
    expect(b.chamadas[0]).toEqual(['evo.enquete', TEL, 'O que deseja?', ['Opção 1', 'Opção 2', 'Opção 3']]);
  });

  it('voz primeiro e o texto escrito depois (link, preço, endereço vão por escrito)', async () => {
    const a = montar(LOJA_CLOUD);
    const r = await a.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'Link: x', audio: { base64: 'AAAA', mime: 'audio/ogg' } });
    expect(r.enviados).toEqual(['voz', 'texto']);
    expect(a.chamadas.map((c) => c[0])).toEqual(['cloud.voz', 'cloud.texto']);
    const b = montar(LOJA_EVO);
    await b.svc.responder(SENHA, { instancia: 'i', para: TEL, audio: { base64: 'AAAA' } });
    expect(b.chamadas).toEqual([['evo.voz', TEL]]);
  });

  it('menu numerado: opção sem título sai, a descrição vai junto', () => {
    expect(menuNumerado('', [{ titulo: 'A', descricao: 'primeira' }, { titulo: ' ' }, { titulo: 'B' }])).toBe(
      '1) A — primeira\n2) B\n\nResponda com o número da opção.',
    );
  });
});
