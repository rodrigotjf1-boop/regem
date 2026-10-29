import { entregarJuntando, esquecerPendentes } from './juntar-mensagens';

/* eslint-disable @typescript-eslint/no-explicit-any */

// JUNTAR AS MENSAGENS SEGUIDAS (Fase 2): "oi" / "tudo bem?" / "tem x-bacon?" = UMA resposta do robô, não três.
const m = (texto: string, extra: any = {}) => ({ tenantId: 't1', de: '5521999998888', tipo: 'text', texto, mensagemId: `id-${texto}`, ...extra });

describe('juntar as mensagens seguidas do cliente', () => {
  let entregues: any[];
  const entregar = async (x: any) => {
    entregues.push(x);
  };
  beforeEach(() => {
    jest.useFakeTimers();
    entregues = [];
    process.env.ROBO_JUNTAR_MS = '3000';
  });
  afterEach(() => {
    esquecerPendentes();
    jest.useRealTimers();
    delete process.env.ROBO_JUNTAR_MS;
  });

  it('três mensagens seguidas viram UMA, com os textos em linhas', async () => {
    await entregarJuntando(m('oi'), entregar);
    await jest.advanceTimersByTimeAsync(1000);
    await entregarJuntando(m('tudo bem?'), entregar);
    await jest.advanceTimersByTimeAsync(2000);
    await entregarJuntando(m('tem x-bacon?'), entregar);
    expect(entregues).toHaveLength(0); // o relógio recomeça a cada mensagem
    await jest.advanceTimersByTimeAsync(3100);
    expect(entregues).toHaveLength(1);
    expect(entregues[0]).toMatchObject({
      texto: 'oi\ntudo bem?\ntem x-bacon?',
      mensagensJuntadas: 3,
      mensagemIds: ['id-oi', 'id-tudo bem?', 'id-tem x-bacon?'],
      mensagemId: 'id-tem x-bacon?',
    });
  });

  it('uma mensagem só vai sozinha, sem os campos de junção', async () => {
    await entregarJuntando(m('cadê meu pedido?'), entregar);
    await jest.advanceTimersByTimeAsync(3100);
    expect(entregues).toEqual([m('cadê meu pedido?')]);
  });

  it('conversas diferentes não se misturam', async () => {
    await entregarJuntando(m('oi'), entregar);
    await entregarJuntando(m('olá', { de: '5521888887777' }), entregar);
    await jest.advanceTimersByTimeAsync(3100);
    expect(entregues.map((x) => x.texto).sort()).toEqual(['oi', 'olá']);
  });

  it('áudio não espera: o texto que estava juntando vai antes, o áudio logo depois', async () => {
    await entregarJuntando(m('olha'), entregar);
    await entregarJuntando(m('', { tipo: 'audio', mensagemId: 'audio-1' }), entregar);
    expect(entregues.map((x) => x.tipo)).toEqual(['text', 'audio']);
    expect(entregues[0].texto).toBe('olha');
  });

  it('ROBO_JUNTAR_MS=0 desliga: cada mensagem vai na hora', async () => {
    process.env.ROBO_JUNTAR_MS = '0';
    await entregarJuntando(m('a'), entregar);
    await entregarJuntando(m('b'), entregar);
    expect(entregues.map((x) => x.texto)).toEqual(['a', 'b']);
  });
});
