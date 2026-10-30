import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import {
  JANELA_DO_AVISO_MS,
  RoboRespostaService,
  avisoDoChamadoLiberado,
  esquecerAvisosDeChamado,
  menuNumerado,
} from './robo-resposta.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A RESPOSTA DO ROBÔ (Fase 2): uma porta para as duas vias. O teste prova as travas (senha, provedor, robô ligado,
// conversa pausada) e o COMO de cada via: botões/lista na API oficial, menu numerado ou enquete na Evolution, voz.
const SENHA = 'senha-do-robo';
const TEL = '5521999998888';

function montar(cfg: any, linhaPausa?: any) {
  const chamadas: any[] = [];
  const db: any = {
    select: () => ({ from: () => ({ where: async () => (cfg ? [cfg] : []) }) }),
    // robo-pausa: sem pausa nem chamado (ou a linha que o teste mandar)
    execute: async () => ({ rows: linhaPausa ? [linhaPausa] : [] }),
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
    enviarLink: async (...a: any[]) => chamadas.push(['cloud.link', a[1], a[2], a[3]]),
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

  // 30/10, loja piloto: o robô chamou o atendente e o aviso "já chamei" era segurado pelo próprio chamado.
  it('chamado que o robô acabou de abrir: o aviso sai UMA vez; depois, calado', async () => {
    esquecerAvisosDeChamado();
    const agora = new Date();
    const linha = (id: string, criado: Date) => ({
      pausa: null,
      chamado: { id, tipo: 'humano', pedido_numero: null, criado_em: criado.toISOString() },
      resolvido_em: null,
      minutos: 60,
      agora: agora.toISOString(),
    });
    const a = montar(LOJA_EVO, linha('ch1', new Date(agora.getTime() - 8_000)));
    expect(await a.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'Já chamei um atendente.' })).toMatchObject({ enviado: true });
    expect(await a.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'De novo?' })).toMatchObject({ enviado: false, motivo: 'conversa_pausada' });
    expect(a.chamadas).toHaveLength(1);
    // Chamado antigo (mais de 90 s): calado desde a primeira.
    const b = montar(LOJA_EVO, linha('ch2', new Date(agora.getTime() - 5 * 60_000)));
    expect(await b.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'oi' })).toMatchObject({ enviado: false });
  });

  it('o aviso só vale quando quem cala é o chamado (atendente que respondeu ou "Pausar" vencem)', () => {
    esquecerAvisosDeChamado();
    const agora = Date.now();
    const chamado = { id: 'c', tipo: 'humano', pedidoNumero: null, criadoEm: new Date(agora - 3_000) };
    expect(avisoDoChamadoLiberado({ pausado: true, ate: null, motivo: 'atendente', chamado }, agora)).toBe(false);
    expect(avisoDoChamadoLiberado({ pausado: true, ate: null, motivo: 'manual', chamado }, agora)).toBe(false);
    expect(avisoDoChamadoLiberado({ pausado: false, ate: null, motivo: null, chamado: null }, agora)).toBe(false);
    expect(avisoDoChamadoLiberado(null, agora)).toBe(false);
    expect(avisoDoChamadoLiberado({ pausado: true, ate: null, motivo: 'chamado', chamado }, agora)).toBe(true);
    expect(avisoDoChamadoLiberado({ pausado: true, ate: null, motivo: 'chamado', chamado }, agora)).toBe(false);
    expect(avisoDoChamadoLiberado({ pausado: true, ate: null, motivo: 'chamado', chamado: { ...chamado, id: 'd', criadoEm: new Date(agora - JANELA_DO_AVISO_MS - 1) } }, agora)).toBe(false);
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

  // Teste dos modelos de 29/10: o modelo escreveu o endereço da loja em outros sistemas (anota.ai, Goomer, Zaply).
  it('link de outro sistema sai trocado pelo do cardápio da loja — no texto e no cabeçalho das opções', async () => {
    const antes = process.env.CARDAPIO_PUBLIC_URL;
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.dmsregem.com';
    try {
      const loja = { ...LOJA_EVO, token: 'tok1' };
      const a = montar(loja);
      await a.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'Veja o cardápio: https://anota.ai/mister' });
      expect(a.chamadas[0]).toEqual(['evo.texto', TEL, 'Veja o cardápio: https://app.dmsregem.com/c/tok1']);
      // Na API oficial o link (já trocado) vai no botão "Ver cardápio" (30/10).
      const b = montar({ ...loja, provedor: 'cloud' });
      await b.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'Monte seu pedido em https://goomer.app/x', opcoes: ops(2) });
      expect(b.chamadas).toEqual([['cloud.link', TEL, 'Monte seu pedido', 'https://app.dmsregem.com/c/tok1']]);
    } finally {
      if (antes === undefined) delete process.env.CARDAPIO_PUBLIC_URL;
      else process.env.CARDAPIO_PUBLIC_URL = antes;
    }
  });

  // Pedido do dono (30/10): na API oficial, o link do cardápio num botão; sem link, botões de resposta como antes.
  it('API oficial: link do cardápio vira o botão "Ver cardápio" (com o link personalizado); Evolution segue no texto', async () => {
    const antes = process.env.CARDAPIO_PUBLIC_URL;
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.dmsregem.com';
    try {
      const cloud = montar({ ...LOJA_CLOUD, token: 'tok1' });
      const r = await cloud.svc.responder(SENHA, {
        phoneNumberId: 'p',
        para: TEL,
        texto: 'O X bacon custa R$ 26,00. Monte seu pedido em https://app.dmsregem.com/c/tok1?cl=abc.',
        opcoes: ops(3),
        audio: { base64: 'AAAA', mime: 'audio/ogg' },
      });
      expect(r.enviados).toEqual(['voz', 'botao_link']);
      expect(cloud.chamadas[1]).toEqual(['cloud.link', TEL, 'O X bacon custa R$ 26,00. Monte seu pedido.', 'https://app.dmsregem.com/c/tok1?cl=abc']);
      // Sem link: botões de resposta, como antes.
      const semLink = montar({ ...LOJA_CLOUD, token: 'tok1' });
      await semLink.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'Posso ajudar?', opcoes: ops(2) });
      expect(semLink.chamadas[0][0]).toBe('cloud.opcoes');
      // Evolution (QR): não tem botão; o link fica no texto.
      const evo = montar({ ...LOJA_EVO, token: 'tok1' });
      await evo.svc.responder(SENHA, { instancia: 'i', para: TEL, texto: 'Cardápio: https://app.dmsregem.com/c/tok1' });
      expect(evo.chamadas[0]).toEqual(['evo.texto', TEL, 'Cardápio: https://app.dmsregem.com/c/tok1']);
    } finally {
      if (antes === undefined) delete process.env.CARDAPIO_PUBLIC_URL;
      else process.env.CARDAPIO_PUBLIC_URL = antes;
    }
  });

  it('menu numerado: opção sem título sai, a descrição vai junto', () => {
    expect(menuNumerado('', [{ titulo: 'A', descricao: 'primeira' }, { titulo: ' ' }, { titulo: 'B' }])).toBe(
      '1) A — primeira\n2) B\n\nResponda com o número da opção.',
    );
  });
});
