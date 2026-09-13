import { adaptarAnotaAi, adaptarDidiFood, adaptarIfood, classificarDesconto } from './adapters';

// Exemplo OFICIAL da doc do 99food (Order Delivered by the Store Couriers). Valores em
// centavos. `shop_subside_price` é o campo que diz quanto a LOJA bancou; o resto é o 99food.
describe('adaptarDidiFood — quem banca a promoção', () => {
  const oficial = {
    order_id: 5764625173055605000,
    order_index: 1,
    pay_type: 2,
    delivery_type: 2, // entrega da loja
    fulfillment_mode: 0,
    receive_address: { name: 'João Silva', calling_code: '+55', phone: '00016007722', city: 'Goiânia' },
    order_items: [
      { app_item_id: '39923', name: 'Combo 99Food', amount: 1, sku_price: 4830000, total_price: 5720000, sub_item_list: [] },
    ],
    price: {
      order_price: 5720000,
      items_discount: 2540000,
      real_price: 4680700,
      real_pay_price: 3180700,
      store_charged_delivery_price: 700,
      delivery_price: 700,
      delivery_discount: 0,
      others_fees: { small_order_price: 0, total_tip_money: 100000, service_price: 0, coupon_discount: 1040000 },
      refund_price: 0,
      customer_need_paying_money: 3280700,
    },
    promotions: [
      { promo_type: 2, promo_discount: 1040000, shop_subside_price: 1040000 }, // 100% da loja
      { promo_type: 11, promo_discount: 1500000, shop_subside_price: 0 }, // 100% do 99food
    ],
  };

  it('separa o que a LOJA bancou do que o 99FOOD bancou', () => {
    const r = adaptarDidiFood(oficial);
    const loja = r.descontos!.filter((d) => d.quemBanca === 'loja').reduce((a, d) => a + d.valor, 0);
    const app = r.descontos!.filter((d) => d.quemBanca === 'marketplace').reduce((a, d) => a + d.valor, 0);
    expect(loja).toBe(10400); // shop_subside_price
    expect(app).toBe(15000); // promo_discount − shop_subside_price
    expect(loja + app).toBe(25400); // = items_discount (2540000 centavos)
  });

  it('bruto = order_price (itens sem promoção e sem entrega)', () => {
    const r = adaptarDidiFood(oficial);
    expect(r.valorBruto).toBe(57200);
  });

  it('a conta oficial fecha: bruto − o que a loja bancou + entrega = real_price', () => {
    const r = adaptarDidiFood(oficial);
    const loja = r.descontos!.filter((d) => d.quemBanca === 'loja').reduce((a, d) => a + d.valor, 0);
    const entrega = oficial.price.delivery_price / 100;
    expect(r.valorBruto! - loja + entrega).toBe(oficial.price.real_price / 100); // 46807
  });

  it('gorjeta do entregador não é receita de produto', () => {
    const r = adaptarDidiFood(oficial);
    expect(r.taxasExtras).toContainEqual({ tipo: 'total_tip_money', rotulo: 'Gorjeta do entregador', valor: 1000 });
  });

  it('entrega da loja (delivery_type 2) = taxa é da loja', () => {
    expect(adaptarDidiFood(oficial).taxaEntregaDono).toBe('loja');
  });

  it('logística do 99food (delivery_type 1): o frete não é receita da loja', () => {
    const r = adaptarDidiFood({ ...oficial, delivery_type: 1 });
    expect(r.taxaEntregaDono).toBe('marketplace');
  });

  it('RETIRADA deixa de virar entrega (fulfillment_mode 1)', () => {
    const r = adaptarDidiFood({
      ...oficial,
      fulfillment_mode: 1,
      delivery_type: 0,
      price: { order_price: 1000, real_price: 1000, real_pay_price: 1000, delivery_price: 0 },
      promotions: [],
    });
    expect(r.tipo).toBe('retirada'); // antes era 'entrega' fixo para TODO pedido da 99
    expect(r.taxaEntregaDono).toBeUndefined();
  });

  it('pedido sem promoção não inventa desconto', () => {
    const r = adaptarDidiFood({ ...oficial, promotions: [], price: { ...oficial.price, delivery_discount: 0 } });
    expect(r.descontos).toBeUndefined();
  });

  // Exemplo oficial nº 2 (99food Delivery com vários tipos de promoção). Prova que
  // promotions[] JÁ CONTÉM a promoção de entrega — somar delivery_discount duplicaria.
  const comEntrega = {
    ...oficial,
    delivery_type: 1,
    price: { order_price: 5460000, items_discount: 2488000, delivery_discount: 400000, shop_paid_money: 0, refund_price: 0 },
    promotions: [
      { promo_type: 2, promo_discount: 168000, shop_subside_price: 0 },
      { promo_type: 2, promo_discount: 1470000, shop_subside_price: 1470000 },
      { promo_type: 3, promo_discount: 400000, shop_subside_price: 0 }, // Frete grátis
      { promo_type: 11, promo_discount: 850000, shop_subside_price: 0 }, // Cupom em item
    ],
  };

  it('NÃO conta o desconto de entrega duas vezes', () => {
    const r = adaptarDidiFood(comEntrega);
    const soma = r.descontos!.reduce((a, d) => a + d.valor, 0);
    // items_discount 2.488.000 + delivery_discount 400.000 = 2.888.000 centavos
    expect(soma).toBe(28880);
  });

  it('classifica pela tabela oficial de promo_type', () => {
    const r = adaptarDidiFood(comEntrega);
    expect(r.descontos!.find((d) => d.campanha === 'Frete grátis por valor')!.origem).toBe('frete');
    expect(r.descontos!.find((d) => d.campanha === 'Cupom em item')!.origem).toBe('cupom');
    expect(r.descontos!.find((d) => d.campanha === 'Item em promoção')).toBeDefined();
  });

  it('clube 99food (promo_type 34) é fidelidade, e bancado por eles', () => {
    const r = adaptarDidiFood({
      ...oficial,
      promotions: [{ promo_type: 34, promo_discount: 500000, shop_subside_price: 0 }],
    });
    expect(r.descontos![0]).toMatchObject({ origem: 'fidelidade', quemBanca: 'marketplace', valor: 5000 });
  });
});

// Payloads da DOCUMENTAÇÃO OFICIAL do iFood. A regra financeira é dele:
//   MERCHANT             → desconto (sai do bolso da loja)
//   IFOOD/EXTERNAL/CHAIN → pagamento (o iFood repassa o valor à loja no acerto semanal)
describe('adaptarIfood — quem banca o desconto', () => {
  const pedido = (benefits: any[], extras = 0) => ({
    id: 'o1',
    displayId: '1234',
    customer: { name: 'Cliente', phone: { number: '21999999999' } },
    items: [{ name: 'Combo', quantity: 1, unitPrice: 40, totalPrice: 50, optionsPrice: 10 }],
    total: { subTotal: 50, deliveryFee: 10, additionalFees: extras, benefits: benefits.reduce((a, b) => a + b.value, 0), orderAmount: 0 },
    payments: { prepaid: 0, pending: 0, methods: [{ value: 55, type: 'OFFLINE', method: 'CASH', cash: { changeFor: 100 } }] },
    delivery: { deliveredBy: 'MERCHANT', deliveryAddress: { formattedAddress: 'Rua X, 1' } },
    benefits,
  });

  it('promoção da LOJA (MERCHANT) é custo dela', () => {
    const r = adaptarIfood(pedido([
      { value: 10, target: 'CART', campaign: { name: 'Minha promo' },
        sponsorshipValues: [{ name: 'IFOOD', value: 0 }, { name: 'MERCHANT', value: 10 }] },
    ]));
    expect(r.descontos).toHaveLength(1); // o patrocinador com valor 0 é descartado
    expect(r.descontos![0]).toMatchObject({ valor: 10, quemBanca: 'loja', campanha: 'Minha promo' });
  });

  it('incentivo do IFOOD é recebível — volta no repasse, não é custo', () => {
    const r = adaptarIfood(pedido([
      { value: 4.99, target: 'ITEM', targetId: '1',
        sponsorshipValues: [{ name: 'IFOOD', value: 4.99 }, { name: 'MERCHANT', value: 0 }] },
    ]));
    expect(r.descontos![0]).toMatchObject({ valor: 4.99, quemBanca: 'marketplace', alvo: 'ITEM' });
  });

  it('benefício CO-PATROCINADO vira duas linhas, cada uma com o seu dono', () => {
    const r = adaptarIfood(pedido([
      { value: 15, target: 'CART',
        sponsorshipValues: [{ name: 'IFOOD', value: 5 }, { name: 'MERCHANT', value: 10 }] },
    ]));
    expect(r.descontos).toHaveLength(2);
    expect(r.descontos!.find((d) => d.quemBanca === 'marketplace')!.valor).toBe(5);
    expect(r.descontos!.find((d) => d.quemBanca === 'loja')!.valor).toBe(10);
  });

  it('EXTERNAL (indústria) e CHAIN (rede) também são recebíveis', () => {
    const r = adaptarIfood(pedido([
      { value: 4.99, target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'EXTERNAL', value: 4.99 }] },
      { value: 5, target: 'CART', sponsorshipValues: [{ name: 'CHAIN', value: 5 }] },
    ]));
    expect(r.descontos!.every((d) => d.quemBanca === 'marketplace')).toBe(true);
  });

  it('valor do item é a linha COM complementos (50), não o unitário (40)', () => {
    const r = adaptarIfood(pedido([]));
    expect(r.itens[0].precoUnitario).toBe(50);
    expect(r.valorBruto).toBe(50); // subTotal declarado pelo iFood
  });

  it('additionalFees do iFood não é receita da loja', () => {
    const r = adaptarIfood(pedido([], 2));
    expect(r.taxasExtras).toEqual([{ tipo: 'ifood_additional_fees', rotulo: 'Taxas do iFood', valor: 2 }]);
  });

  it('logística do iFood: o frete cobrado do cliente não é receita da loja', () => {
    const base = pedido([]);
    const r = adaptarIfood({ ...base, delivery: { ...base.delivery, deliveredBy: 'IFOOD' } });
    expect(r.taxaEntregaDono).toBe('marketplace');
  });

  it('troco em dinheiro (cash.changeFor) é preservado', () => {
    const r = adaptarIfood(pedido([]));
    expect(r.pagamentos![0].troco).toBe(100);
    expect(r.pagamentos![0].prepago).toBe(false); // OFFLINE = cobrar na entrega
  });
});

// Payloads REAIS de produção (Anota Aí, set/2026), com o cliente anonimizado. São os casos
// que expuseram o problema: um resgate de fidelidade que zera o pedido chegava ao Regem como
// um pedido de R$ 0,00, e os R$ 32,50 que a loja bancou sumiam.
describe('adaptarAnotaAi — valores separados por origem', () => {
  const base = {
    _id: 'x1',
    type: 'DELIVERY',
    customer: { name: 'Cliente', phone: '21999999999' },
    items: [{ name: 'Combo', quantity: 1, price: 32.5 }],
    deliveryFee: 0,
    additionalFees: [],
  };

  it('resgate de fidelidade que cobre o pedido inteiro: total 0, mas o desconto NÃO some', () => {
    const r = adaptarAnotaAi({
      ...base,
      total: 0,
      payments: [{ code: 'money', name: 'money', value: '0', prepaid: false, changeFor: null }],
      discounts: [{ tag: 'fidelidade', amount: 32.5, target: 'CART' }],
    });
    expect(r.total).toBe(0); // o cliente não pagou nada
    expect(r.valorPagoCliente).toBe(0);
    expect(r.valorBruto).toBe(32.5); // ...mas foram vendidos R$ 32,50
    expect(r.descontos).toHaveLength(1);
    expect(r.descontos![0]).toMatchObject({
      origem: 'fidelidade',
      rotulo: 'fidelidade',
      valor: 32.5,
      alvo: 'CART',
      quemBanca: 'loja', // canal próprio da loja: quem paga a conta é ela
    });
  });

  it('pedido misto (brinde + item pago): bruto 60, desconto 32,50, cliente paga 27,50', () => {
    const r = adaptarAnotaAi({
      ...base,
      items: [
        { name: 'Combo', quantity: 1, price: 32.5 },
        { name: 'Refrigerante', quantity: 1, price: 27.5 },
      ],
      total: 27.5,
      payments: [{ code: 'money', name: 'money', value: '27.5', prepaid: false, changeFor: 50 }],
      discounts: [{ tag: 'fidelidade', amount: 32.5, target: 'CART' }],
    });
    expect(r.valorBruto).toBe(60);
    expect(r.valorPagoCliente).toBe(27.5);
    expect(r.descontos![0].valor).toBe(32.5);
    // O troco vinha em `changeFor` e era descartado — o entregador saía sem saber.
    expect(r.pagamentos![0].troco).toBe(50);
  });

  it('pedido sem desconto: bruto = pago, e nada de desconto inventado', () => {
    const r = adaptarAnotaAi({
      ...base,
      items: [{ name: 'X-Burger', quantity: 1, price: 27 }],
      total: 27,
      payments: [
        { code: 'ifood-online-pix-payin', name: 'ifood-online-pix-payin', value: '27', prepaid: true },
      ],
      discounts: [],
    });
    expect(r.valorBruto).toBe(27);
    expect(r.descontos).toBeUndefined();
    expect(r.pagamentos![0].prepago).toBe(true); // pré-pago: NÃO é "a cobrar" na entrega
    expect(r.pago).toBe(true);
  });

  it('guarda a bandeira do cartão, que hoje se perde', () => {
    const r = adaptarAnotaAi({
      ...base,
      total: 67,
      payments: [
        { code: 'card', name: 'card', value: '67', prepaid: false, externalId: 'CREDITO', cardSelected: 'Banricard crédito' },
      ],
      discounts: [],
    });
    expect(r.pagamentos![0].bandeira).toBe('Banricard crédito');
  });

  it('taxa de entrega cobrada do cliente é receita da LOJA e não entra no bruto dos produtos', () => {
    const r = adaptarAnotaAi({
      ...base,
      items: [{ name: 'X-Burger', quantity: 1, price: 30 }],
      total: 38, // 30 de produto + 8 de entrega
      deliveryFee: 8,
      payments: [{ code: 'money', name: 'money', value: '38', prepaid: false }],
      discounts: [],
    });
    expect(r.valorBruto).toBe(30); // só o produto
    expect(r.valorPagoCliente).toBe(38); // o que o cliente pagou
    expect(r.taxaEntregaDono).toBe('loja');
  });
});

// Payload OFICIAL da documentação da Anota Aí. É o caso que prova o buraco dos adicionais:
// o ".Lanchão" custa 13 de base + 2,50 de bacon + 2,00 de ovo = 17,50 de linha.
describe('adaptarAnotaAi — payload oficial da documentação', () => {
  const oficial = {
    info: {
      _id: '6206ac9b25a2c30013c23e1b',
      shortReference: 53,
      type: 'DELIVERY',
      salesChannel: 'anotaai',
      customer: { name: 'Beto', phone: '9999999999' },
      payments: [
        { name: 'money', code: 'money', value: '20', cardSelected: '', changeFor: 20, prepaid: false },
      ],
      items: [
        {
          id: 0, name: '.Lanchão', quantity: 1, price: 13, total: 17.5,
          subItems: [
            { name: '.Bacon', quantity: 1, price: 2.5, total: 2.5, externalCode: 'extra' },
            { name: '.Ovo', quantity: 1, price: 2, total: 2, externalCode: 'extra' },
          ],
        },
      ],
      total: 12.5,
      deliveryFee: 0,
      discounts: [{ amount: 5, tag: 'CUPOMTESTE' }],
    },
  };

  it('o item vale a LINHA com adicionais (17,50), não só a base (13,00)', () => {
    const r = adaptarAnotaAi(oficial);
    expect(r.itens[0].precoUnitario).toBe(17.5); // antes gravava 13,00 e perdia R$ 4,50
    expect(r.itens[0].complementos).toBe('.Bacon · .Ovo');
  });

  it('bruto 17,50 = pago 12,50 + cupom 5,00 — e a soma dos itens confere', () => {
    const r = adaptarAnotaAi(oficial);
    expect(r.valorBruto).toBe(17.5);
    expect(r.valorPagoCliente).toBe(12.5);
    const somaItens = r.itens.reduce((a, i) => a + i.precoUnitario * i.quantidade, 0);
    expect(somaItens).toBe(r.valorBruto); // sem divergência: nada de adicional perdido
  });

  it('a tag do cupom é o próprio código e é classificada como cupom', () => {
    const r = adaptarAnotaAi(oficial);
    expect(r.descontos![0]).toMatchObject({ origem: 'cupom', rotulo: 'CUPOMTESTE', valor: 5 });
  });

  it('troco: changeFor 20 numa conta de 12,50 é preservado', () => {
    const r = adaptarAnotaAi(oficial);
    expect(r.pagamentos![0].troco).toBe(20);
  });

  it('pedido do iFood importado NÃO é creditado como desconto da loja', () => {
    const r = adaptarAnotaAi({
      info: { ...oficial.info, salesChannel: 'ifood' },
    });
    // Não dá para afirmar quem patrocinou — 'loja' seria custo falso.
    expect(r.descontos![0].quemBanca).toBe('indefinido');
  });

  it('gorjeta do garçom NÃO entra no bruto dos produtos (payload oficial: 10 + 1 = 11)', () => {
    const r = adaptarAnotaAi({
      info: {
        ...oficial.info,
        type: 'LOCAL',
        items: [{ name: 'Refrigerante 1L', quantity: 1, price: 10, total: 10, subItems: [] }],
        total: 11,
        discounts: [],
        additionalFees: [{ type: 'waiter_tip', description: 'Taxa do garçom', value: 1 }],
      },
    });
    expect(r.valorBruto).toBe(10); // produto
    expect(r.valorPagoCliente).toBe(11); // o que o cliente pagou
    expect(r.taxasExtras).toEqual([{ tipo: 'waiter_tip', rotulo: 'Taxa do garçom', valor: 1 }]);
  });

  it('taxa de serviço do pagamento online também sai do bruto', () => {
    const r = adaptarAnotaAi({
      info: {
        ...oficial.info,
        items: [{ name: 'X', quantity: 1, price: 10, total: 10, subItems: [] }],
        total: 10.99,
        discounts: [],
        additionalFees: [{ type: 'addition_pol', description: 'Taxa de serviço do POL', value: 0.99 }],
      },
    });
    expect(r.valorBruto).toBe(10);
    expect(r.taxasExtras![0].tipo).toBe('addition_pol');
  });

  it('aceita a nomenclatura da doc (amount/totalPrice) além da do payload real', () => {
    const r = adaptarAnotaAi({
      info: {
        ...oficial.info,
        items: [{ name: 'X', quantity: 2, amount: 10, totalPrice: 25 }],
      },
    });
    expect(r.itens[0].precoUnitario).toBe(12.5); // 25 / 2
  });
});

describe('classificarDesconto — a etiqueta do canal decide o balde', () => {
  it.each([
    ['fidelidade', 'fidelidade'],
    ['Clube de pontos', 'fidelidade'],
    ['loyalty', 'fidelidade'],
    ['cashback', 'cashback'],
    ['CUPOM10', 'cupom'],
    ['voucher primeira compra', 'cupom'],
    ['frete grátis', 'frete'],
    ['promoção de aniversário', 'promocao'],
    // Tags OFICIAIS da Anota Aí
    ['Fidelidade', 'fidelidade'],
    ['Cashback', 'cashback'],
    ['promoção', 'promocao'],
    ['CUPOMDENATAL', 'cupom'],
    ['Desconto via PDV', 'manual'], // operador abateu na mão — vira trilha de auditoria
  ])('%s → %s', (tag, esperado) => {
    expect(classificarDesconto(tag)).toBe(esperado);
  });

  it('código de cupom solto (a tag É o código) é reconhecido como cupom', () => {
    expect(classificarDesconto('NATAL10')).toBe('cupom');
    expect(classificarDesconto('BLACKFRIDAY')).toBe('cupom');
  });

  it('etiqueta desconhecida cai em "outro" em vez de chutar', () => {
    expect(classificarDesconto('sei la')).toBe('outro');
    expect(classificarDesconto(null)).toBe('outro');
  });
});
