import { JobsService } from './jobs.service';
import { edgeAtivo } from '../../common/edge-ativo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O ALERTA DE ESTOQUE DE CADA LOJA NASCE NUM LADO SÓ (ERR-075). O `alerta_estoque` vai e volta pelo sync com id aleatório e
// um aberto por (empresa, loja, tipo): se a nuvem e o servidor da loja abrem o mesmo, o segundo esbarra no índice (23505) e
// os lados divergem. O servidor da loja calcula só a loja dele; a nuvem, só as lojas sem servidor ligado.

jest.mock('../../common/edge-ativo', () => ({ edgeAtivo: jest.fn() }));
const edgeLigado = edgeAtivo as jest.Mock;

const T = 'empresa-1';
/** Banco de mentira: a rotina só lê as lojas da empresa (e, sem lista, as empresas). */
const banco = (lojas: string[]) => ({
  execute: async (q: any) => {
    const texto = JSON.stringify(q?.queryChunks ?? q);
    if (texto.includes('from unidade')) return { rows: lojas.map((id) => ({ id })) };
    if (texto.includes('from empresa')) return { rows: [{ id: T }] };
    return { rows: [] };
  },
});

describe('alerta de estoque: cada loja num lado só', () => {
  const antes = { edge: process.env.EDGE_MODE, loja: process.env.EDGE_UNIDADE_ID };
  afterEach(() => {
    for (const [k, v] of [['EDGE_MODE', antes.edge], ['EDGE_UNIDADE_ID', antes.loja]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    edgeLigado.mockReset();
  });
  const u = undefined as any;
  const svc = (lojas: string[], estoque: any = u, events: any = u) => new JobsService(banco(lojas) as any, u, estoque, u, u, u, u, events);

  it('no servidor da loja: só a loja dele; servidor antigo (sem EDGE_UNIDADE_ID): todas; loja única: o alerta da empresa', async () => {
    process.env.EDGE_MODE = 'true';
    process.env.EDGE_UNIDADE_ID = 'B';
    expect(await svc(['A', 'B', 'C']).alvosDesteLado(T)).toEqual(['B']);
    expect(await svc(['A']).alvosDesteLado(T)).toEqual([null]);
    delete process.env.EDGE_UNIDADE_ID;
    expect(await svc(['A', 'B', 'C']).alvosDesteLado(T)).toEqual(['A', 'B', 'C']);
    expect(edgeLigado).not.toHaveBeenCalled();
  });

  it('na nuvem: só as lojas sem servidor ligado agora', async () => {
    delete process.env.EDGE_MODE;
    edgeLigado.mockImplementation(async (_db: any, _t: string, loja: string | null) => loja === 'B');
    expect(await svc(['A', 'B', 'C']).alvosDesteLado(T)).toEqual(['A', 'C']);
    expect(edgeLigado.mock.calls.map((c) => c[2])).toEqual(['A', 'B', 'C']);
    edgeLigado.mockReset();
    edgeLigado.mockResolvedValue(true);
    expect(await svc(['A']).alvosDesteLado(T)).toEqual([]); // loja única com o servidor ligado: é ele
    edgeLigado.mockResolvedValue(false);
    expect(await svc(['A']).alvosDesteLado(T)).toEqual([null]);
  });

  it('o ponto de pedido e as validades só registram o alerta das lojas deste lado', async () => {
    delete process.env.EDGE_MODE;
    edgeLigado.mockImplementation(async (_db: any, _t: string, loja: string | null) => loja === 'B');
    const registrados: string[] = [];
    const estoque = {
      resolverAlertasSistema: async () => undefined,
      inteligencia: async () => ({ itens: [{ nome: 'Pão', repor: true }] }),
      validades: async () => [{ status: 'vencido', itemNome: 'Leite' }],
      registrarAlerta: async (_t: string, tipo: string, d: any) => registrados.push(`${tipo}:${d.unidadeId}`),
    };
    const s = svc(['A', 'B', 'C'], estoque, { emit: () => undefined });
    (s as any).log = { log: () => undefined, error: () => undefined };
    await s.pontoDePedido([T]);
    await s.validadesFefo([T]);
    expect(registrados).toEqual(['ponto_pedido:A', 'ponto_pedido:C', 'validade:A', 'validade:C']);
  });

  it('chamada pelo @Cron com um argumento que não é lista: passa por todas as empresas, sem quebrar', async () => {
    delete process.env.EDGE_MODE;
    edgeLigado.mockResolvedValue(false);
    const vistos: string[] = [];
    const estoque = {
      resolverAlertasSistema: async () => undefined,
      validades: async () => [],
      registrarAlerta: async () => undefined,
    };
    const s = svc(['A'], { ...estoque, validades: async (t: string) => (vistos.push(t), []) });
    await s.validadesFefo((() => undefined) as any);
    expect(vistos).toEqual([T]);
  });
});
