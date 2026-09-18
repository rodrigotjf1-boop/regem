import { ImpressaoController } from './impressao.controller';
import { ImpressaoSinalService } from './impressao-sinal.service';

/* eslint-disable @typescript-eslint/no-explicit-any */

// ESPERA LONGA do agente de impressão (nuvem), sem banco: conta as reservas que uma espera faz.
// Medido antes: 6 reservas por espera de 25 s mesmo com o aviso do banco (LISTEN) funcionando —
// com 5 mil agentes parados, 1.200 consultas/s onde bastavam ~400.

function montar(ouvindo: boolean) {
  const sinal = new ImpressaoSinalService({} as any, { get: () => '' } as any);
  if (ouvindo) (sinal as any).cliente = {}; // LISTEN de pé
  let reservas = 0;
  const servico: any = {
    registrarAgente: () => {},
    jobsPendentes: async () => {
      reservas++;
      return [];
    },
  };
  const ctl = new ImpressaoController(servico, sinal);
  const esperar = (seg: number) =>
    ctl.pendentesEspera({ tenantId: 't1', unidadeId: null } as any, { maquina: 'CX', espera: seg }, { socket: {} });
  return { sinal, esperar, reservas: () => reservas };
}

describe('espera longa da fila de impressão', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('com o aviso do banco de pé: 2 reservas por espera (início e fim)', async () => {
    const m = montar(true);
    const p = m.esperar(25);
    await jest.advanceTimersByTimeAsync(26_000);
    await p;
    expect(m.reservas()).toBe(2);
  });

  it('sem o aviso: reconsulta a cada 5 s (rede de segurança)', async () => {
    const m = montar(false);
    const p = m.esperar(25);
    await jest.advanceTimersByTimeAsync(26_000);
    await p;
    expect(m.reservas()).toBe(6);
  });

  it('aviso que chega durante a espera acorda na hora', async () => {
    const m = montar(true);
    const p = m.esperar(25);
    await jest.advanceTimersByTimeAsync(1_000);
    m.sinal.avisar('t1');
    await jest.advanceTimersByTimeAsync(0);
    expect(m.reservas()).toBe(2); // reconsultou na hora, sem esperar os 25 s
    await jest.advanceTimersByTimeAsync(26_000);
    await p;
  });

  it('aviso que chegou ENTRE a consulta e o início da espera não se perde (e não gira sem fim)', async () => {
    const sinal = new ImpressaoSinalService({} as any, { get: () => '' } as any);
    (sinal as any).cliente = {};
    const marca = sinal.marca('t1'); // lida antes da consulta
    sinal.avisar('t1'); // job entrou antes de a espera começar
    let voltou = false;
    const p = sinal.esperar('t1', 25_000, marca).then(() => (voltou = true));
    await jest.advanceTimersByTimeAsync(0);
    expect(voltou).toBe(true);
    await p;
  });
});
