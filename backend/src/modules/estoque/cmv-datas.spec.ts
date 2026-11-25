import { EstoqueController } from './estoque.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PAINEL DO CMV SEM DATAS = O MÊS DA LOJA (EST-G-03 da revisão de 25/11/2026). A tela chama a rota sem intervalo; antes o padrão
// saía do relógio do SERVIDOR — na nuvem (UTC), às 21h30 do dia 30 em São Paulo (00h30 do dia 1º em UTC) o painel mostrava
// "01/12 a 01/12". O intervalo que a pessoa escolhe continua valendo.
describe('CMV — o período padrão é o mês corrente da loja', () => {
  const tzAntes = process.env.TZ;
  afterEach(() => {
    jest.useRealTimers();
    if (tzAntes === undefined) delete process.env.TZ;
    else process.env.TZ = tzAntes;
  });

  const controlador = () => {
    const chamadas: any[][] = [];
    const ctrl = new EstoqueController({ cmvReal: async (...a: any[]) => chamadas.push(a) } as any, {} as any);
    return { ctrl, chamadas };
  };

  it('servidor em UTC, 21h30 do dia 30/11 em São Paulo: 01/11 a 30/11', async () => {
    process.env.TZ = 'UTC';
    jest.useFakeTimers({ now: new Date('2026-12-01T00:30:00Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'queueMicrotask'] });
    const { ctrl, chamadas } = controlador();
    await ctrl.cmv({ tenantId: 't1' } as any, null, undefined, undefined);
    expect(chamadas[0].slice(1, 3)).toEqual(['2026-11-01', '2026-11-30']);
  });

  it('o intervalo escolhido pela pessoa continua valendo', async () => {
    const { ctrl, chamadas } = controlador();
    await ctrl.cmv({ tenantId: 't1' } as any, null, '2026-10-01', '2026-10-15');
    expect(chamadas[0].slice(1, 3)).toEqual(['2026-10-01', '2026-10-15']);
  });
});
