import {
  ehDoTotem,
  enderecoDoPedido,
  pedidoNoCanal,
  perfilDeProducao,
  rotuloDoCanal,
  tipoDoPedido,
  tipoNaProducao,
} from './via-do-pedido';

// Os dados do pedido de canal como saem impressos (via do delivery, comanda do entregador, via de produção).
describe('via do pedido — dados do pedido de canal no papel', () => {
  it('o canal com o nome que o cliente e o entregador conhecem, e o nº do pedido nele', () => {
    expect(rotuloDoCanal('ifood')).toBe('iFood');
    expect(rotuloDoCanal('99food')).toBe('99Food');
    expect(rotuloDoCanal('n8n')).toBe('WhatsApp');
    expect(rotuloDoCanal('Cardápio')).toBe('Cardápio'); // o rótulo que a venda já grava passa direto
    expect(rotuloDoCanal('canal_novo')).toBe('canal_novo');
    expect(pedidoNoCanal('ifood', '8F2A')).toBe('iFood #8F2A');
    expect(pedidoNoCanal('cardapio', '#12')).toBe('Cardápio #12'); // sem "##"
    expect(pedidoNoCanal('anotaai', null)).toBe('Anota Aí');
    expect(pedidoNoCanal(null, null)).toBeUndefined();
  });

  it('endereço pelos campos separados, uma informação por linha e sem repetir', () => {
    // O texto inteiro já trazia número e bairro: a comanda do entregador juntava os dois e repetia tudo.
    expect(
      enderecoDoPedido({
        endereco: 'Rua das Flores, 10 - Centro',
        enderecoRua: 'Rua das Flores',
        enderecoNumero: '10',
        enderecoBairro: 'Centro',
        enderecoCidade: 'Cidade Fictícia',
        enderecoReferencia: 'portão azul',
      }),
    ).toBe('Rua das Flores, 10\nCentro - Cidade Fictícia\nRef: portão azul');
    expect(enderecoDoPedido({ endereco: 'Rua das Flores, 10 - Centro' })).toBe('Rua das Flores, 10 - Centro');
    expect(enderecoDoPedido({ enderecoRua: 'Rua das Flores' })).toBe('Rua das Flores');
    expect(enderecoDoPedido({})).toBeUndefined();
  });

  it('o tipo do pedido: entrega, retirada e encomenda', () => {
    expect(tipoDoPedido({ tipo: 'entrega' })).toBe('DELIVERY');
    expect(tipoDoPedido({ tipo: null })).toBe('DELIVERY');
    expect(tipoDoPedido({ tipo: 'retirada' })).toBe('RETIRADA');
    expect(tipoDoPedido({ tipo: 'retirada', retiradaTipo: 'encomenda' })).toBe('ENCOMENDA');
  });

  it('o totem (o nosso e o do GoGeM) é venda de balcão', () => {
    expect(ehDoTotem('totem')).toBe(true);
    expect(ehDoTotem('GoGeM')).toBe(true);
    expect(ehDoTotem('ifood')).toBe(false);
    expect(ehDoTotem(null)).toBe(false);
  });

  it('o modelo da via de produção: pedido de canal (entrega ou retirada) usa o do delivery', () => {
    expect(perfilDeProducao('delivery', 'iFood')).toBe('producao_delivery');
    expect(perfilDeProducao('balcao', 'iFood')).toBe('producao_delivery'); // retirada pedida no iFood
    expect(perfilDeProducao('balcao', 'Cardápio')).toBe('producao_delivery');
    expect(perfilDeProducao('balcao', null)).toBe('producao_balcao'); // venda do PDV
    expect(perfilDeProducao('mesa', null)).toBe('producao_balcao');
    expect(perfilDeProducao('totem', 'Totem')).toBe('producao_balcao');
    expect(perfilDeProducao('balcao', 'Totem')).toBe('producao_balcao'); // totem aceito pelo painel
    expect(perfilDeProducao('balcao', 'gogem')).toBe('producao_balcao');
  });

  it('a linha do tipo na via de produção: só no pedido de canal', () => {
    expect(tipoNaProducao({ origem: 'delivery', plataforma: 'iFood' })).toBe('DELIVERY');
    expect(tipoNaProducao({ origem: 'balcao', plataforma: 'iFood' })).toBe('RETIRADA');
    expect(tipoNaProducao({ origem: 'balcao', plataforma: 'Cardápio', tipoPedido: 'ENCOMENDA' })).toBe('ENCOMENDA');
    expect(tipoNaProducao({ origem: 'balcao', plataforma: null })).toBeUndefined();
    expect(tipoNaProducao({ origem: 'totem', plataforma: 'Totem' })).toBeUndefined();
  });
});
