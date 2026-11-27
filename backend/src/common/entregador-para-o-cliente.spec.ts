import { comNomeDoEntregadorParaOCliente, entregadoresQueCompartilham, nomeDoEntregadorParaOCliente } from './entregador-para-o-cliente';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O nome do entregador que o cliente pode ver (ERR-623): a regra do rastreio em toda rota pública e do robô.
const LOJA_A = '11111111-1111-4111-8111-111111111111';
const LOJA_B = '22222222-2222-4222-8222-222222222222';
const T = '33333333-3333-4333-8333-333333333333';

describe('o nome do entregador para o cliente', () => {
  it('o da loja só com a permissão; o da plataforma (sem id) como veio; sem nome, null', () => {
    const compartilham = new Set([LOJA_B]);
    expect(nomeDoEntregadorParaOCliente({ entregadorId: LOJA_A, entregadorNome: 'Carlos' }, compartilham)).toBeNull();
    expect(nomeDoEntregadorParaOCliente({ entregadorId: LOJA_B, entregadorNome: 'Bruna' }, compartilham)).toBe('Bruna');
    expect(nomeDoEntregadorParaOCliente({ entregadorId: null, entregadorNome: 'Entregador iFood' }, compartilham)).toBe('Entregador iFood');
    expect(nomeDoEntregadorParaOCliente({ entregadorId: LOJA_B, entregadorNome: null }, compartilham)).toBeNull();
  });

  it('UMA consulta para a lista toda; sem id da loja, nenhuma consulta', async () => {
    const execute = jest.fn(async () => ({ rows: [{ id: LOJA_B }] }));
    const db = { execute } as any;
    const linhas = [
      { numero: 1, entregadorId: LOJA_A, entregadorNome: 'Carlos' },
      { numero: 2, entregadorId: LOJA_B, entregadorNome: 'Bruna' },
      { numero: 3, entregadorId: LOJA_B, entregadorNome: 'Bruna' },
      { numero: 4, entregadorId: null, entregadorNome: 'Entregador iFood' },
    ];
    const r = await comNomeDoEntregadorParaOCliente(db, T, linhas);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(r.map((x) => [x.numero, x.entregadorNome])).toEqual([
      [1, null],
      [2, 'Bruna'],
      [3, 'Bruna'],
      [4, 'Entregador iFood'],
    ]);
    expect(r.every((x: any) => !('entregadorId' in x))).toBe(true); // o id não sai
    execute.mockClear();
    await comNomeDoEntregadorParaOCliente(db, T, [{ entregadorId: null, entregadorNome: 'X' }]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('sem a tabela (servidor da loja: ela é só da nuvem), ninguém compartilhou; outro erro sobe', async () => {
    const semTabela = { execute: async () => Promise.reject(Object.assign(new Error('relação não existe'), { code: '42P01' })) } as any;
    expect([...(await entregadoresQueCompartilham(semTabela, T, [LOJA_A]))]).toEqual([]);
    const fora = { execute: async () => Promise.reject(Object.assign(new Error('caiu'), { code: '57P01' })) } as any;
    await expect(entregadoresQueCompartilham(fora, T, [LOJA_A])).rejects.toThrow('caiu');
    // id que não é uuid não vai à consulta
    const execute = jest.fn(async () => ({ rows: [] }));
    await entregadoresQueCompartilham({ execute } as any, T, ["x'; drop table colaborador; --", '', null]);
    expect(execute).not.toHaveBeenCalled();
  });
});
