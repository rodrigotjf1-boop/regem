import {
  MARCA_DA_RESPOSTA_SEGURADA,
  MAX_SEGURADAS,
  andamentoDe,
  entregarSegurando,
  esquecerAndamentos,
  fimDaResposta,
  trocarRelogio,
  valeSegurar,
} from './resposta-em-andamento';
import { definirPorteiroDaPausa, entregarComPorteiro, entregarJuntando, esquecerPendentes } from './juntar-mensagens';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A "CONVERSA PICOTADA" (pedido do dono, 16/11/2026): o cliente manda uma mensagem, a IA começa a responder, ele manda
// outra antes da resposta sair — antes, saíam DUAS respostas, a 1ª sem saber da 2ª mensagem. Agora a resposta velha é
// segurada, tudo vai de novo ao robô e o cliente recebe UMA resposta.
const TEL = '5521999998888';
const m = (texto: string, extra: any = {}) => ({ tenantId: 't1', provedor: 'cloud', de: TEL, tipo: 'text', texto, mensagemId: `id-${texto}`, ...extra });

describe('a resposta em andamento (uma resposta por vez em cada conversa)', () => {
  let entregues: any[];
  let deNovo: any[];
  let agora: number;
  const entregar = async (x: any) => {
    entregues.push(x);
    return true;
  };
  const reentregar = async (x: any) => {
    deNovo.push(x);
    return entregarSegurando(x, entregar, reentregar);
  };
  beforeEach(() => {
    jest.useFakeTimers();
    entregues = [];
    deNovo = [];
    agora = 1_800_000_000_000;
    trocarRelogio(() => agora);
    delete process.env.ROBO_SEGURAR_MS;
  });
  afterEach(() => {
    esquecerAndamentos();
    esquecerPendentes();
    definirPorteiroDaPausa(null);
    trocarRelogio(null);
    jest.useRealTimers();
    delete process.env.ROBO_SEGURAR_MS;
    delete process.env.ROBO_JUNTAR_MS;
  });

  it('o caso do dono: a 2ª mensagem chega com a 1ª resposta em preparo — a resposta velha não sai e tudo vai de novo, UMA vez', async () => {
    await entregarSegurando(m('tem x-bacon?'), entregar, reentregar);
    expect(entregues.map((x) => x.texto)).toEqual(['tem x-bacon?']);
    // a IA está pensando; o cliente manda outra
    agora += 4000;
    expect(await entregarSegurando(m('e entrega no centro?'), entregar, reentregar)).toBe(true);
    expect(entregues).toHaveLength(1); // a 2ª NÃO foi ao robô sozinha
    expect(andamentoDe('t1', TEL)).toMatchObject({ fila: 1, seguradas: 0 });
    // chega a resposta da 1ª: ficou velha — não sai, e o robô recebe as duas juntas, com a marca
    agora += 3000;
    expect(fimDaResposta('t1', TEL, true)).toBe('descartar');
    await jest.advanceTimersByTimeAsync(0);
    expect(deNovo).toHaveLength(1);
    expect(deNovo[0]).toMatchObject({
      texto: `${MARCA_DA_RESPOSTA_SEGURADA}\ntem x-bacon?\ne entrega no centro?`,
      textosDoCliente: ['tem x-bacon?', 'e entrega no centro?'],
      mensagensJuntadas: 2,
      mensagemIds: ['id-tem x-bacon?', 'id-e entrega no centro?'],
      respostaSegurada: 1,
      // os campos são os da mensagem mais nova
      mensagemId: 'id-e entrega no centro?',
    });
    expect(entregues).toHaveLength(2);
    // a resposta DESSA vez é a que sai, e a conversa fica livre
    expect(fimDaResposta('t1', TEL, true)).toBe('enviar');
    expect(andamentoDe('t1', TEL)).toBeNull();
  });

  it('sem mensagem nova a resposta sai; sem resposta em andamento também (o caminho de sempre)', async () => {
    expect(fimDaResposta('t1', TEL, true)).toBe('enviar');
    await entregarSegurando(m('oi'), entregar, reentregar);
    expect(fimDaResposta('t1', TEL, true)).toBe('enviar');
    expect(andamentoDe('t1', TEL)).toBeNull();
    // a próxima mensagem vai direto ao robô
    await entregarSegurando(m('tem coca?'), entregar, reentregar);
    expect(entregues.map((x) => x.texto)).toEqual(['oi', 'tem coca?']);
    expect(deNovo).toHaveLength(0);
  });

  it('a resposta que não sai (robô desligado, conversa com uma pessoa, vazia): o que esperou vai ao robô SOZINHO, sem a marca', async () => {
    await entregarSegurando(m('oi'), entregar, reentregar);
    agora += 2000;
    await entregarSegurando(m('cadê meu pedido?'), entregar, reentregar);
    expect(fimDaResposta('t1', TEL, false)).toBe('enviar');
    await jest.advanceTimersByTimeAsync(0);
    expect(deNovo).toHaveLength(1);
    expect(deNovo[0].texto).toBe('cadê meu pedido?');
    expect(deNovo[0].texto).not.toContain(MARCA_DA_RESPOSTA_SEGURADA);
  });

  it(`o cliente que não para de escrever não fica sem resposta: depois de ${MAX_SEGURADAS} vezes a resposta sai e o novo vai em seguida`, async () => {
    await entregarSegurando(m('a'), entregar, reentregar);
    for (let i = 1; i <= MAX_SEGURADAS; i++) {
      agora += 1000;
      await entregarSegurando(m(`mais ${i}`), entregar, reentregar);
      expect(fimDaResposta('t1', TEL, true)).toBe('descartar');
      await jest.advanceTimersByTimeAsync(0);
    }
    expect(andamentoDe('t1', TEL)).toMatchObject({ seguradas: MAX_SEGURADAS, textos: ['a', 'mais 1', 'mais 2'] });
    agora += 1000;
    await entregarSegurando(m('e agora?'), entregar, reentregar);
    expect(fimDaResposta('t1', TEL, true)).toBe('enviar'); // passou do limite: a resposta sai
    await jest.advanceTimersByTimeAsync(0);
    expect(deNovo.at(-1).texto).toBe('e agora?'); // e o que chegou vai sozinho, sem a marca
  });

  it('a resposta que não chega no prazo solta o que esperava, com tudo o que o cliente escreveu (a anterior não veio)', async () => {
    process.env.ROBO_SEGURAR_MS = '40000';
    await entregarSegurando(m('oi'), entregar, reentregar);
    agora += 10_000;
    await entregarSegurando(m('alô?'), entregar, reentregar);
    await jest.advanceTimersByTimeAsync(29_000);
    expect(deNovo).toHaveLength(0);
    agora += 30_000;
    await jest.advanceTimersByTimeAsync(1_000);
    expect(deNovo).toHaveLength(1);
    expect(deNovo[0].texto).toBe(`${MARCA_DA_RESPOSTA_SEGURADA}\noi\nalô?`);
    // a resposta em andamento passa a ser a nova
    expect(andamentoDe('t1', TEL)).toMatchObject({ fila: 0, textos: ['oi', 'alô?'] });
    // passado o prazo sem nada esperando, a mensagem seguinte vai direto (não fica presa numa resposta que não veio)
    agora += 41_000;
    await entregarSegurando(m('tem alguém?'), entregar, reentregar);
    expect(entregues.at(-1).texto).toBe('tem alguém?');
  });

  it('a entrega que falha (robô fora do ar) não deixa nada esperando por uma resposta que não vem', async () => {
    const falha = async (x: any) => {
      entregues.push(x);
      return false;
    };
    await entregarSegurando(m('oi'), falha, reentregar);
    expect(andamentoDe('t1', TEL)).toBeNull();
    await entregarSegurando(m('oi de novo'), falha, reentregar);
    expect(entregues.map((x) => x.texto)).toEqual(['oi', 'oi de novo']);
  });

  it('só WhatsApp, só texto: Direct, Messenger, mídia e mensagem sem empresa passam como sempre; conversas não se misturam', async () => {
    expect(valeSegurar(m('x'))).toBe(true);
    expect(valeSegurar(m('x', { provedor: 'evolution' }))).toBe(true);
    expect(valeSegurar(m('x', { tipo: 'interactive' }))).toBe(true); // o toque no botão é mensagem do cliente
    expect(valeSegurar(m('x', { provedor: 'instagram', de: 'ig:123' }))).toBe(false);
    expect(valeSegurar(m('x', { provedor: 'messenger' }))).toBe(false);
    expect(valeSegurar(m('x', { tipo: 'audio' }))).toBe(false);
    expect(valeSegurar(m('x', { tipo: 'image' }))).toBe(false);
    expect(valeSegurar(m('x', { tenantId: null }))).toBe(false);
    expect(valeSegurar(m('x', { de: 'fb:999' }))).toBe(false);
    await entregarSegurando(m('oi'), entregar, reentregar);
    // o áudio do mesmo cliente não espera (segue como antes)
    await entregarSegurando(m('', { tipo: 'audio' }), entregar, reentregar);
    // outro telefone e outra empresa: cada conversa tem a sua
    await entregarSegurando(m('oi', { de: '5521988887777' }), entregar, reentregar);
    await entregarSegurando(m('oi', { tenantId: 't2' }), entregar, reentregar);
    expect(entregues).toHaveLength(4);
    // o telefone vem com ou sem sinal: a mesma conversa
    expect(fimDaResposta('t1', `+${TEL}`, true)).toBe('enviar');
    expect(andamentoDe('t1', TEL)).toBeNull();
  });

  it('desligado (ROBO_SEGURAR_MS=0): tudo vai direto, como antes', async () => {
    process.env.ROBO_SEGURAR_MS = '0';
    await entregarSegurando(m('a'), entregar, reentregar);
    await entregarSegurando(m('b'), entregar, reentregar);
    expect(entregues.map((x) => x.texto)).toEqual(['a', 'b']);
    expect(fimDaResposta('t1', TEL, true)).toBe('enviar');
  });

  it('pelo caminho de verdade (junção + porteiro): o texto que chega depois da junção espera, e a reentrega passa pelo porteiro', async () => {
    process.env.ROBO_JUNTAR_MS = '3000';
    const vistosPeloPorteiro: string[] = [];
    definirPorteiroDaPausa(async (x: any) => {
      vistosPeloPorteiro.push(x.texto);
      return 'segue';
    });
    await entregarJuntando(m('oi'), (x: any) => entregarComPorteiro(x, entregar));
    await jest.advanceTimersByTimeAsync(3000);
    expect(entregues.map((x) => x.texto)).toEqual(['oi']);
    // depois da junção, com a resposta em preparo: espera
    agora += 5000;
    await entregarJuntando(m('tudo bem?'), (x: any) => entregarComPorteiro(x, entregar));
    await jest.advanceTimersByTimeAsync(3000);
    expect(entregues).toHaveLength(1);
    expect(fimDaResposta('t1', TEL, true)).toBe('descartar');
    await jest.advanceTimersByTimeAsync(0);
    expect(entregues).toHaveLength(2);
    expect(entregues[1].texto).toBe(`${MARCA_DA_RESPOSTA_SEGURADA}\noi\ntudo bem?`);
    // o porteiro viu a 1ª, a 2ª e a reentrega (a pausa do cardápio vale também para ela)
    expect(vistosPeloPorteiro).toEqual(['oi', 'tudo bem?', `${MARCA_DA_RESPOSTA_SEGURADA}\noi\ntudo bem?`]);
  });

  it('o porteiro que responde a reentrega (cardápio pausado) não deixa a conversa presa', async () => {
    let respondePeloRegem = false;
    definirPorteiroDaPausa(async () => (respondePeloRegem ? 'respondido' : 'segue'));
    process.env.ROBO_JUNTAR_MS = '0';
    await entregarJuntando(m('oi'), (x: any) => entregarComPorteiro(x, entregar));
    agora += 2000;
    await entregarJuntando(m('alô'), (x: any) => entregarComPorteiro(x, entregar));
    respondePeloRegem = true;
    expect(fimDaResposta('t1', TEL, true)).toBe('descartar');
    await jest.advanceTimersByTimeAsync(0);
    expect(andamentoDe('t1', TEL)).toBeNull();
    expect(entregues).toHaveLength(1);
  });
});
