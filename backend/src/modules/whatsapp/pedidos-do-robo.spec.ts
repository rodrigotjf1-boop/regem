import { horaDoPedido, pedidosParaORobo } from './pedidos-do-robo';

// Teste do robô com a loja piloto (29/10/2026): "cadê meu pedido?" respondeu o pedido 10 e "meu pedido já saiu?" o 64 —
// a lista vinha sem a marca do mais recente. A rota segue devolvendo a lista (o robô antigo lê o mesmo formato).
describe('pedidos do cliente para o robô', () => {
  it('o primeiro (o mais novo) vem marcado; todos com a posição e a hora de São Paulo', () => {
    const r = pedidosParaORobo([
      { numero: 64, status: 'saiu', criadoEm: new Date('2026-10-30T00:43:00Z') },
      { numero: 10, status: 'entregue', criadoEm: '2026-10-28T23:05:00Z' },
    ]);
    expect(r).toEqual([
      { numero: 64, status: 'saiu', criadoEm: new Date('2026-10-30T00:43:00Z'), ordem: 1, maisRecente: true, criadoEmTexto: '29/10 21:43' },
      { numero: 10, status: 'entregue', criadoEm: '2026-10-28T23:05:00Z', ordem: 2, maisRecente: false, criadoEmTexto: '28/10 20:05' },
    ]);
  });

  it('sem pedido: lista vazia; data ruim não quebra', () => {
    expect(pedidosParaORobo([])).toEqual([]);
    expect(horaDoPedido(null)).toBeNull();
    expect(horaDoPedido('não é data')).toBeNull();
  });
});
