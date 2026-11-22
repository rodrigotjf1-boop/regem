import { atrasoDoStatus } from './anotaai-atraso';
import { AnotaAiService } from './anotaai.service';

const AGORA = new Date('2026-11-22T01:00:00.000Z');
const antes = (segundos: number) => new Date(AGORA.getTime() - segundos * 1000).toISOString();

describe('Anota Aí: quanto o Regem demorou para ver o status', () => {
  it('separa em faixas', () => {
    expect(atrasoDoStatus(antes(22), AGORA)).toEqual({ segundos: 22, faixa: 'ate_1_min' });
    expect(atrasoDoStatus(antes(60), AGORA)?.faixa).toBe('ate_1_min');
    expect(atrasoDoStatus(antes(61), AGORA)?.faixa).toBe('de_1_a_5_min');
    expect(atrasoDoStatus(antes(300), AGORA)?.faixa).toBe('de_1_a_5_min');
    expect(atrasoDoStatus(antes(900), AGORA)?.faixa).toBe('de_5_a_15_min');
    expect(atrasoDoStatus(antes(901), AGORA)?.faixa).toBe('mais_de_15_min');
  });

  it('hora inválida ou muito no futuro não vira medida; relógio pouco adiantado conta zero', () => {
    for (const v of [undefined, null, '', 'ontem', 123]) expect(atrasoDoStatus(v, AGORA)).toBeNull();
    expect(atrasoDoStatus(antes(-61), AGORA)).toBeNull();
    expect(atrasoDoStatus(antes(-30), AGORA)).toEqual({ segundos: 0, faixa: 'ate_1_min' });
  });

  const servico = (execute: jest.Mock) => {
    const s = new AnotaAiService({ execute } as any, {} as any, {} as any);
    const pedido = jest.spyOn(s, 'pedido');
    return { s, pedido };
  };
  const IG = { id: 'i', tenantId: 't', unidadeId: null, token: 'x', lojaId: null, config: {} };

  it('usa a hora da lista e só busca o detalhe quando ela não traz', async () => {
    const execute = jest.fn().mockResolvedValue({ rows: [] });
    const { s, pedido } = servico(execute);
    await s.medirAtrasoDoStatus(IG, null, 'p1', 'despachado', { updatedAt: new Date().toISOString() });
    expect(pedido).not.toHaveBeenCalled();
    expect(execute).toHaveBeenCalledTimes(1);
    pedido.mockResolvedValue({ updatedAt: new Date().toISOString() });
    await s.medirAtrasoDoStatus(IG, null, 'p2', 'despachado', { check: 2 });
    expect(pedido).toHaveBeenCalledWith(IG, 'p2');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('sem hora não grava, e a falha da medida não derruba a rotina', async () => {
    const execute = jest.fn().mockRejectedValue(new Error('banco fora'));
    const { s, pedido } = servico(execute);
    pedido.mockResolvedValue(null);
    await expect(s.medirAtrasoDoStatus(IG, null, 'p3', 'concluido', {})).resolves.toBeUndefined();
    expect(execute).not.toHaveBeenCalled();
    await expect(s.medirAtrasoDoStatus(IG, null, 'p4', 'concluido', { updatedAt: new Date().toISOString() })).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
