import { partesDoItem, resumoDoPedido } from './robo-resumo';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O RESUMO DO PEDIDO DO ROBÔ (F4): do pedido GRAVADO, uma informação por linha, o que importa em negrito.
const PED: any = {
  displayId: '45',
  clienteNome: 'Ana Maria',
  status: 'novo',
  tipo: 'entrega',
  itens: [
    { descricao: 'X-Bacon (Bacon extra, Sim)', quantidade: 2, precoUnitario: 29.9, observacao: 'sem cebola' },
    { descricao: 'Coca-Cola lata', quantidade: 1, precoUnitario: 6 },
  ],
  valorBruto: '65.80',
  taxaEntrega: '5',
  desconto: '0',
  total: '70.80',
  enderecoRua: 'Rua A',
  enderecoNumero: '10',
  enderecoBairro: 'Centro',
  enderecoReferencia: 'portão azul',
  formaPagamento: 'entrega',
  trocoPara: '100',
};

describe('resumo do pedido registrado pelo robô', () => {
  it('as escolhas saem do texto do item, cada uma na sua linha', () => {
    expect(partesDoItem('X-Bacon · Grande (Bacon extra, Coca-Cola)')).toEqual({ nome: 'X-Bacon · Grande', escolhas: ['Bacon extra', 'Coca-Cola'] });
    expect(partesDoItem('Coca-Cola lata')).toEqual({ nome: 'Coca-Cola lata', escolhas: [] });
  });

  it('número, itens com escolhas e observação, totais, entrega, pagamento e troco — em blocos', () => {
    const r = resumoDoPedido(PED, { formaNome: 'Pagar na entrega (dinheiro ou maquininha)', tempoMin: 40 });
    expect(r.texto).toBe(
      [
        '✅ *Pedido nº 45 registrado!*',
        'Obrigado, Ana!',
        '',
        '🧾 *Itens*',
        '*2x X-Bacon* — R$ 59,80',
        '   + Bacon extra',
        '   + Sim',
        '   📝 _sem cebola_',
        '*1x Coca-Cola lata* — R$ 6,00',
        '',
        'Subtotal: R$ 65,80',
        'Taxa de entrega: R$ 5,00',
        '💰 *Total: R$ 70,80*',
        '',
        '🛵 *Entrega*',
        'Rua A, 10',
        'Centro',
        'Ref.: portão azul',
        '⏱️ Previsão de entrega: até 40 min',
        '',
        '💳 *Pagamento*',
        'Pagar na entrega (dinheiro ou maquininha)',
        'Troco para R$ 100,00 → *troco de R$ 29,20*',
        '',
        '📩 *Recebemos seu pedido!* Assim que a loja aceitar, ele entra em produção.',
      ].join('\n'),
    );
    expect(r).toMatchObject({ aceito: false, situacao: 'recebido — a loja vai aceitar em instantes' });
  });

  it('aceito pela loja: "aceito e já está em produção"; retirada sem endereço; frete grátis', () => {
    const r = resumoDoPedido({ ...PED, status: 'confirmado' });
    expect(r.aceito).toBe(true);
    expect(r.texto).toContain('👨‍🍳 *Seu pedido foi aceito e já está em produção!*');
    const ret = resumoDoPedido({ ...PED, tipo: 'retirada', taxaEntrega: '0', trocoPara: null, total: '65.80' }, { tempoMin: 20 });
    expect(ret.texto).toContain('🏪 *Retirada na loja*');
    expect(ret.texto).toContain('⏱️ Fica pronto em: até 20 min');
    expect(ret.texto).not.toContain('Rua A');
    expect(ret.texto).not.toContain('Troco');
    expect(resumoDoPedido({ ...PED, taxaEntrega: '0' }).texto).toContain('Entrega: *grátis* 🎉');
  });
});
