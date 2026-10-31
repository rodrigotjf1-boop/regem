import { OPCOES_DA_CONFERENCIA, ParaConferir, partesDoItem, resumoDoPedido, textoParaConferir } from './robo-resumo';

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

  it('F5: a observação GERAL do pedido sai num bloco próprio (a gravada; senão a do carrinho)', () => {
    const r = resumoDoPedido(PED, { observacao: 'interfone ruim, ligar ao chegar' });
    expect(r.texto).toContain('📝 *Observação do pedido*\ninterfone ruim, ligar ao chegar');
    expect(resumoDoPedido({ ...PED, observacao: 'não buzinar' }, { observacao: 'outra' }).texto).toContain('📝 *Observação do pedido*\nnão buzinar');
    expect(resumoDoPedido(PED).texto).not.toContain('Observação do pedido');
  });
});

describe('F5: o resumo PARA CONFERIR (antes de registrar), com os botões', () => {
  const base: ParaConferir = {
    itens: [
      { quantidade: 1, descricao: 'TRIO X-BACON (Batata Frita - Media, Coca Cola - Lata)', observacao: 'sem cebola', totalCent: 3600 },
      { quantidade: 2, descricao: 'Coca lata', observacao: null, totalCent: 1200 },
    ],
    subtotal: 48,
    tipo: 'entrega',
    endereco: { rua: 'Av N. Sra. da Penha', numero: '400', bairro: 'Penha', referencia: 'Pro mult market' },
    taxa: 5,
    total: 53,
    formaNome: 'Dinheiro (pago na entrega)',
    trocoPara: 100,
    semTroco: false,
    observacao: 'interfone ruim, ligar ao chegar',
  };
  it('itens com as escolhas e a observação, totais, entrega, pagamento, troco e a observação do pedido — em blocos', () => {
    expect(textoParaConferir(base)).toBe(
      [
        '🧾 *Confere o seu pedido:*',
        '',
        '*1x TRIO X-BACON* — R$ 36,00',
        '   + Batata Frita - Media',
        '   + Coca Cola - Lata',
        '   📝 _sem cebola_',
        '*2x Coca lata* — R$ 12,00',
        '',
        'Subtotal: R$ 48,00',
        'Taxa de entrega: R$ 5,00',
        '💰 *Total: R$ 53,00*',
        '',
        '🛵 *Entrega*',
        'Av N. Sra. da Penha, 400',
        'Penha',
        'Ref.: Pro mult market',
        '',
        '💳 *Pagamento*',
        'Dinheiro (pago na entrega)',
        'Troco para R$ 100,00 → *troco de R$ 47,00*',
        '',
        '📝 *Observação do pedido*',
        'interfone ruim, ligar ao chegar',
        '',
        'Está tudo certo? 👇',
      ].join('\n'),
    );
    expect(OPCOES_DA_CONFERENCIA).toEqual(['Pode registrar', 'Pôr observação', 'Quero mudar algo']);
    expect(OPCOES_DA_CONFERENCIA.every((o) => o.length <= 20)).toBe(true); // cabem nos botões
  });
  it('retirada; sem troco; entrega grátis; sem observação', () => {
    const ret = textoParaConferir({ ...base, tipo: 'retirada', endereco: null, taxa: 0, trocoPara: null, semTroco: true, observacao: null });
    expect(ret).toContain('🏪 *Retirada na loja*');
    expect(ret).toContain('Sem troco');
    expect(ret).not.toContain('Taxa de entrega');
    expect(ret).not.toContain('Observação do pedido');
    expect(textoParaConferir({ ...base, taxa: 0 })).toContain('Entrega: *grátis* 🎉');
  });
});
