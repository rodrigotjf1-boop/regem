import { RelatoriosController } from './relatorios.controller';

/* eslint-disable @typescript-eslint/no-explicit-any */

// A tela Relatórios › Vendas lê a conta oficial, a mesma do Painel e do Mister (ERR-564). A soma só das comandas deixava o
// faturado menor que o do Painel: sem a taxa de entrega da loja e com a comanda do pedido que o canal cancelou.
describe('GET /relatorios/vendas', () => {
  const resposta = { resumo: { faturado: 128 } };
  const servico = { vendasOficiais: jest.fn(async () => resposta), vendas: jest.fn() };
  const rota = new RelatoriosController(servico as any);

  beforeEach(() => jest.clearAllMocks());

  it('usa a conta oficial, com a loja, o período e a permissão de ver valores', async () => {
    const user: any = { tenantId: 't1', permissoes: { ver_financeiro: true } };
    await expect(rota.vendas(user, 'loja-1', '2026-11-01', '2026-11-07')).resolves.toBe(resposta);
    expect(servico.vendasOficiais).toHaveBeenCalledWith('t1', '2026-11-01', '2026-11-07', true, 'loja-1');
    expect(servico.vendas).not.toHaveBeenCalled();
  });

  it('quem não tem a permissão continua sem os valores', async () => {
    await rota.vendas({ tenantId: 't1', permissoes: {} } as any, null);
    expect(servico.vendasOficiais).toHaveBeenCalledWith('t1', undefined, undefined, false, null);
  });
});
