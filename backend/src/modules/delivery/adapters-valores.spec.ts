import {
  adaptarAnotaAi,
  adaptarCardapioWeb,
  adaptarDidiFood,
  adaptarIfood,
  adaptarOpenDelivery,
  classificarDesconto,
} from './adapters';

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

// Spec Open Delivery v1.7.1 (Abrasel). Canal `delivery_direto`/`open_delivery`.
// Armadilha do padrão: em total/otherFees/discounts o valor é OBJETO {value,currency};
// em payments.methods[].value é número puro.
describe('adaptarOpenDelivery — sponsorshipValues e receivedBy', () => {
  const brl = (v: number) => ({ value: v, currency: 'BRL' });
  const pedido = (extra: any = {}) => ({
    id: 'od1',
    displayId: '77',
    customer: { name: 'Cliente', phone: { number: '21999999999' } },
    items: [{ name: 'Combo', quantity: 2, unitPrice: brl(20), optionsPrice: brl(5), totalPrice: brl(50) }],
    total: { itemsPrice: brl(50), otherFees: brl(5), discount: brl(20), orderAmount: brl(35) },
    payments: { prepaid: 0, pending: 35, methods: [{ value: 35, currency: 'BRL', type: 'PENDING', method: 'CASH', changeFor: 50 }] },
    delivery: { deliveredBy: 'MERCHANT', deliveryAddress: { formattedAddress: 'Rua X, 1' } },
    otherFees: [{ name: 'Taxa de entrega', type: 'DELIVERY_FEE', receivedBy: 'MERCHANT', price: brl(5) }],
    ...extra,
  });

  it('desconto 50/50 entre marketplace e loja vira duas linhas', () => {
    const r = adaptarOpenDelivery(pedido({
      discounts: [{
        amount: brl(20), target: 'DELIVERY_FEE',
        sponsorshipValues: [
          { name: 'MARKETPLACE', amount: brl(10) },
          { name: 'MERCHANT', amount: brl(10) },
        ],
      }],
    }));
    expect(r.descontos).toHaveLength(2);
    expect(r.descontos!.find((d) => d.quemBanca === 'loja')!.valor).toBe(10);
    expect(r.descontos!.find((d) => d.quemBanca === 'marketplace')!.valor).toBe(10);
  });

  it('CHAIN (rede) é bancado por terceiro, não pela loja', () => {
    const r = adaptarOpenDelivery(pedido({
      discounts: [{ amount: brl(7), target: 'CART', sponsorshipValues: [{ name: 'CHAIN', amount: brl(7) }] }],
    }));
    expect(r.descontos![0].quemBanca).toBe('marketplace');
  });

  it('discountCode identifica cupom e vira o rótulo', () => {
    const r = adaptarOpenDelivery(pedido({
      discounts: [{
        amount: brl(5), target: 'ITEM', targetId: 'item-1',
        sponsorshipValues: [{ name: 'MERCHANT', amount: brl(5), discountCode: 'CUPOM500' }],
      }],
    }));
    expect(r.descontos![0]).toMatchObject({ origem: 'cupom', quemBanca: 'loja', campanha: 'CUPOM500' });
  });

  it('receivedBy é o destino econômico da taxa, não quem coletou', () => {
    expect(adaptarOpenDelivery(pedido()).taxaEntregaDono).toBe('loja');
    const r = adaptarOpenDelivery(pedido({
      otherFees: [{ name: 'Taxa', type: 'DELIVERY_FEE', receivedBy: 'LOGISTIC_SERVICES', price: brl(5) }],
    }));
    expect(r.taxaEntregaDono).toBe('marketplace');
  });

  it('item vale a linha COM adicionais: totalPrice 50 / 2 un = 25', () => {
    const r = adaptarOpenDelivery(pedido());
    expect(r.itens[0].precoUnitario).toBe(25);
    expect(r.valorBruto).toBe(50); // total.itemsPrice
  });

  it('gorjeta e taxa de serviço saem do bruto; a de entrega não entra como taxa extra', () => {
    const r = adaptarOpenDelivery(pedido({
      otherFees: [
        { name: 'Taxa de entrega', type: 'DELIVERY_FEE', receivedBy: 'MERCHANT', price: brl(5) },
        { name: 'Gorjeta', type: 'TIP', receivedBy: 'MERCHANT', price: brl(3) },
      ],
    }));
    expect(r.taxasExtras).toEqual([{ tipo: 'TIP', rotulo: 'Gorjeta', valor: 3 }]);
  });

  it('methods[].value é número puro (não objeto) e changeFor é o troco', () => {
    const r = adaptarOpenDelivery(pedido());
    expect(r.pagamentos![0].valor).toBe(35);
    expect(r.pagamentos![0].troco).toBe(50);
    expect(r.pagamentos![0].prepago).toBe(false); // PENDING = cobrar na entrega
  });
});

// Exemplo OFICIAL do spec api-pedidos.json do Cardápio Web. A equação é declarada na doc:
// total = Σ items.total_price + delivery_fee + service_fee + additional_fee
//         + Σ payments.payment_fee − Σ discounts.total
describe('adaptarCardapioWeb', () => {
  const oficial = {
    id: 7637461,
    display_id: 47,
    order_type: 'delivery',
    delivered_by: 'merchant',
    customer: { name: 'Matheus Lessa', phone: '85994197929' },
    delivery_address: { street: 'Av. Jovita Feitosa', number: '2992', neighborhood: 'Parquelândia', city: 'Fortaleza', state: 'CE' },
    delivery_fee: 5,
    service_fee: 0,
    additional_fee: 8,
    total: 181.3,
    items: [
      { item_id: 208907, name: 'Hamburguer', quantity: 1, unit_price: 12.9, total_price: 28.9, kind: 'regular_item', options: [] },
      { item_id: 208909, name: 'Hamburguer + Pizza', quantity: 1, unit_price: 0, total_price: 137.9, kind: 'combo', options: [] },
    ],
    discounts: [{ kind: 'discount', category: 'other', total: 3, total_points: 0, coupon_id: null, coupon_name: null }],
    payments: [
      { total: 50, payment_fee: 0, payment_type: 'offline', change_of: null, status: 'pending', payment_method: 'pix' },
      { total: 31.5, payment_fee: 1.5, payment_type: 'offline', status: 'pending', payment_method: 'credit_card' },
      { total: 99.8, payment_fee: 3, payment_type: 'offline', status: 'pending', payment_method: 'debit_card' },
    ],
  };

  it('a equação oficial fecha: 166,80 + 5 + 0 + 8 + 4,50 − 3 = 181,30', () => {
    const r = adaptarCardapioWeb(oficial);
    const taxas = r.taxasExtras!.reduce((a, f) => a + f.valor, 0);
    const desc = r.descontos!.reduce((a, d) => a + d.valor, 0);
    expect(r.valorBruto).toBe(166.8); // soma de items[].total_price (não existe subtotal)
    expect(r.valorBruto! + oficial.delivery_fee + taxas - desc).toBeCloseTo(181.3, 2);
    expect(r.valorPagoCliente).toBe(181.3);
  });

  it('pagamento DIVIDIDO em 3 métodos é preservado', () => {
    const r = adaptarCardapioWeb(oficial);
    expect(r.pagamentos).toHaveLength(3);
    expect(r.pagamentos!.reduce((a, p) => a + p.valor, 0)).toBeCloseTo(181.3, 2);
  });

  it('payment_fee é taxa cobrada do cliente, não desconto', () => {
    const r = adaptarCardapioWeb(oficial);
    expect(r.taxasExtras).toContainEqual({ tipo: 'payment_fee', rotulo: 'Taxa da forma de pagamento', valor: 4.5 });
  });

  it('resgate de FIDELIDADE é reconhecido e guarda os pontos gastos', () => {
    const r = adaptarCardapioWeb({
      ...oficial,
      discounts: [{ kind: 'item', category: 'loyalty', total: 32.5, total_points: 100, item_id: 9, item_name: 'Combo' }],
    });
    expect(r.descontos![0]).toMatchObject({
      origem: 'fidelidade', rotulo: 'Resgate: Combo', valor: 32.5, alvo: 'ITEM',
      quemBanca: 'loja', campanha: '100 pontos',
    });
  });

  it('cupom patrocinado pelo iFood NÃO é custo da loja', () => {
    const r = adaptarCardapioWeb({
      ...oficial,
      discounts: [{ kind: 'discount', category: 'coupon', total: 10, sponsorship: 'ifood', coupon_code: 'IF10', coupon_name: 'iFood 10' }],
    });
    expect(r.descontos![0]).toMatchObject({ origem: 'cupom', quemBanca: 'marketplace', campanha: 'IF10' });
  });

  it('pagamento ONLINE deixa de virar "a cobrar na entrega"', () => {
    const r = adaptarCardapioWeb({
      ...oficial,
      payments: [{ total: 181.3, payment_fee: 0, payment_type: 'online', status: 'paid', payment_method: 'online_credit_card', card_brand: 'visa' }],
    });
    // Antes testava prepaid/paid/online — campos que NÃO existem nessa API.
    expect(r.pago).toBe(true);
    expect(r.pagamentos![0].prepago).toBe(true);
    expect(r.pagamentos![0].bandeira).toBe('visa');
  });

  it('logística de terceiro: a taxa não é receita da loja', () => {
    expect(adaptarCardapioWeb(oficial).taxaEntregaDono).toBe('loja');
    expect(adaptarCardapioWeb({ ...oficial, delivered_by: 'ifood_shipping' }).taxaEntregaDono).toBe('marketplace');
  });

  it('troco aceita change_for E change_of (o spec diverge do próprio exemplo)', () => {
    expect(adaptarCardapioWeb({ ...oficial, payments: [{ total: 50, payment_method: 'money', change_of: 100, payment_type: 'offline' }] }).pagamentos![0].troco).toBe(100);
    expect(adaptarCardapioWeb({ ...oficial, payments: [{ total: 50, payment_method: 'money', change_for: 100, payment_type: 'offline' }] }).pagamentos![0].troco).toBe(100);
  });

  it('sem unit_price, o total da linha é dividido pela quantidade', () => {
    const r = adaptarCardapioWeb({
      id: 'cw1', order_type: 'delivery', customer: { name: 'X', phone: '21999999999' },
      items: [{ name: 'Refri', quantity: 3, total_price: 60 }], total: 60,
    });
    // Antes gravava 60 por unidade → 180 no caixa (3x o valor real).
    expect(r.itens[0].precoUnitario).toBe(20);
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
