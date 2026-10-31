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

// O texto de uma consulta `sql` do drizzle (só os pedaços fixos), para o banco de mentira saber o que responder.
const textoDaConsulta = (q: any) => (q?.queryChunks ?? []).flatMap((c: any) => (Array.isArray(c?.value) ? c.value : [])).join(' ');

function montar(cfg: any, linhaPausa?: any, dados: { produtos?: any[]; conversa?: any[] } = {}) {
  const chamadas: any[] = [];
  const fotos: (string | null)[] = [];
  const db: any = {
    select: () => ({ from: () => ({ where: async () => (cfg ? [cfg] : []) }) }),
    execute: async (q: any) => {
      const t = textoDaConsulta(q);
      // foto-do-produto.ts: os produtos da loja e a conversa (vazios = nada a conferir, como antes)
      if (/from produto\b/.test(t)) return { rows: dados.produtos ?? [] };
      if (/from whatsapp_mensagem\b/.test(t)) return { rows: dados.conversa ?? [] };
      // robo-pausa: sem pausa nem chamado (ou a linha que o teste mandar)
      return { rows: linhaPausa ? [linhaPausa] : [] };
    },
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
    enviarLink: async (...a: any[]) => {
      fotos.push(a[5] ?? null);
      chamadas.push(['cloud.link', a[1], a[2], a[3], a[4]]);
      return { ok: true, comFoto: !!a[5] };
    },
  };
  const svc = new RoboRespostaService(db, evolution, cloud);
  (svc as any).logger = { log() {}, warn() {} };
  // A foto "serve" sem ir à rede (JPEG pequeno).
  (svc as any).buscarFoto = async () => ({
    status: 206,
    headers: { get: (k: string) => ({ 'content-type': 'image/jpeg', 'content-range': 'bytes 0-0/50000' })[k.toLowerCase()] ?? null },
    body: { cancel: async () => undefined },
  });
  return { svc, chamadas, fotos };
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
      expect(b.chamadas).toEqual([['cloud.link', TEL, 'Monte seu pedido', 'https://app.dmsregem.com/c/tok1', 'Ver cardápio']]);
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
      expect(cloud.chamadas[1]).toEqual(['cloud.link', TEL, 'O X bacon custa R$ 26,00. Monte seu pedido.', 'https://app.dmsregem.com/c/tok1?cl=abc', 'Ver cardápio']);
      // Link DIRETO do produto (F2, `?produto=`): o botão diz "Ver no cardápio" — abre aquele item.
      const produto = montar({ ...LOJA_CLOUD, token: 'tok1' });
      await produto.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'O X Bacon sai por R$ 26,00: https://app.dmsregem.com/c/tok1?produto=xb1' });
      expect(produto.chamadas[0]).toEqual(['cloud.link', TEL, 'O X Bacon sai por R$ 26,00', 'https://app.dmsregem.com/c/tok1?produto=xb1', 'Ver no cardápio']);
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

  // 2º teste do dono (31/10, ERR-335): "Tem foto do trio 07?" saiu com o link e a foto do LANCHE "Numero 07"; "Tem foto do
  // trio 08?" saiu com um link inventado pela IA, sem foto. O Regem confere o produto pelo que o cliente pediu.
  it('foto pedida: o Regem manda o produto PEDIDO (link, foto e legenda) — também quando a IA inventou o link', async () => {
    const antes = process.env.CARDAPIO_PUBLIC_URL;
    process.env.CARDAPIO_PUBLIC_URL = 'https://app.dmsregem.com';
    try {
      const N07 = 'aaaaaaaa-0000-4000-8000-000000000007';
      const T07 = 'bbbbbbbb-0000-4000-8000-000000000007';
      const T08 = 'bbbbbbbb-0000-4000-8000-000000000008';
      const INVENTADO = 'deadbeef-0000-4000-8000-000000000000';
      const produtos = [
        { id: N07, nome: 'Numero 07', imagem: 'https://fotos.exemplo/n07.png' },
        { id: T07, nome: 'TRIO 07', imagem: 'https://fotos.exemplo/t07.jpg' },
        { id: T08, nome: 'TRIO 08', imagem: 'https://fotos.exemplo/t08.jpg' },
      ];
      // A conversa, da mais nova para a mais velha: a pergunta desta vez; a resposta anterior da loja corta.
      const conversa = (pergunta: string) => [
        { direcao: 'entrada', texto: pergunta },
        { direcao: 'saida', texto: 'resposta anterior' },
        { direcao: 'entrada', texto: 'tem foto do x-bacon?' },
      ];
      const loja = { ...LOJA_CLOUD, token: 'tok1' };
      const link = (id: string) => `https://app.dmsregem.com/c/tok1?produto=${id}`;

      const t07 = montar(loja, undefined, { produtos, conversa: conversa('Tem foto do trio 07?') });
      const r = await t07.svc.responder(SENHA, {
        phoneNumberId: 'p',
        para: TEL,
        texto: `Dá uma olhada na foto e nos detalhes do Número 07 no cardápio ${link(N07)}`,
      });
      expect(r.enviados).toEqual(['botao_link_com_foto']);
      expect(t07.chamadas[0]).toEqual([
        'cloud.link',
        TEL,
        '📸 *TRIO 07*\nToque em "Ver no cardápio" para ver os detalhes e pedir.',
        link(T07),
        'Ver no cardápio',
      ]);
      expect(t07.fotos[0]).toBe('https://fotos.exemplo/t07.jpg');

      // Link inventado (a loja não tem esse produto): vai o TRIO 08 que o cliente pediu, com a foto.
      const t08 = montar(loja, undefined, { produtos, conversa: conversa('Tem foto do trio 08?') });
      await t08.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: `Olha a foto do Número 08 ${link(INVENTADO)}` });
      expect(t08.chamadas[0].slice(2)).toEqual(['📸 *TRIO 08*\nToque em "Ver no cardápio" para ver os detalhes e pedir.', link(T08), 'Ver no cardápio']);
      expect(t08.fotos[0]).toBe('https://fotos.exemplo/t08.jpg');

      // A IA acertou: o texto e o link dela ficam, com a foto.
      const certo = montar(loja, undefined, { produtos, conversa: conversa('tem foto do trio 07?') });
      await certo.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: `Olha o Trio 07: ${link(T07)}` });
      expect(certo.chamadas[0]).toEqual(['cloud.link', TEL, 'Olha o Trio 07', link(T07), 'Ver no cardápio']);
      expect(certo.fotos[0]).toBe('https://fotos.exemplo/t07.jpg');

      // A IA mandou o link do cardápio TODO (o personalizado, ?u=): pediu a foto do trio → o botão abre o trio, com a foto.
      const geral = montar(loja, undefined, { produtos, conversa: conversa('me mostra o trio 07') });
      await geral.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'Dá uma olhada no cardápio: https://app.dmsregem.com/c/tok1?u=ab12' });
      expect(geral.chamadas[0].slice(3)).toEqual([`https://app.dmsregem.com/c/tok1?u=ab12&produto=${T07}`, 'Ver no cardápio']);
      expect(geral.fotos[0]).toBe('https://fotos.exemplo/t07.jpg');
      // Sem pedido de foto, o link do cardápio todo vai como a IA mandou.
      const semFoto = montar(loja, undefined, { produtos, conversa: conversa('quero pedir o trio 07') });
      await semFoto.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: 'Monte seu pedido: https://app.dmsregem.com/c/tok1?u=ab12' });
      expect(semFoto.chamadas[0].slice(2)).toEqual(['Monte seu pedido', 'https://app.dmsregem.com/c/tok1?u=ab12', 'Ver cardápio']);
      expect(semFoto.fotos[0]).toBeNull();

      // Link inventado e nenhum produto citado: o link do cardápio, sem foto, com o convite (nada de "olha a foto").
      const nada = montar(loja, undefined, { produtos, conversa: conversa('oi') });
      await nada.svc.responder(SENHA, { phoneNumberId: 'p', para: TEL, texto: `Olha que delícia ${link(INVENTADO)}` });
      expect(nada.chamadas[0]).toEqual([
        'cloud.link',
        TEL,
        'Dá uma olhada no cardápio 👇 Lá tem a foto e os detalhes de cada produto.',
        'https://app.dmsregem.com/c/tok1',
        'Ver cardápio',
      ]);
      expect(nada.fotos[0]).toBeNull();
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
