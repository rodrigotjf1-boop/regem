/* eslint-disable @typescript-eslint/no-explicit-any */
// Adaptadores de canal → modelo interno. O cliente real do iFood (OAuth +
// polling de eventos) roda no EDGE e faz POST /delivery/ingest com o pedido
// bruto; aqui só mapeamos o formato. Adicionar novos canais = novo adaptador.

export interface PedidoNormalizado {
  externalId?: string;
  displayId?: string;
  clienteNome?: string;
  clienteTelefone?: string;
  tipo: 'entrega' | 'retirada';
  endereco?: string;
  itens: {
    produtoId?: string; // quando a origem já conhece o produto (ex.: cardápio)
    codigo?: string;
    descricao: string;
    quantidade: number;
    precoUnitario: number;
    observacao?: string; // observação REAL do cliente ("sem cebola")
    complementos?: string; // complementos escolhidos (batata, bebida…) — NÃO é observação
    opcaoIds?: string[]; // ids das opções escolhidas (só origem interna: cardápio Regem/totem) — roteamento por opção/etapa (Fase 1). Marketplaces não mandam nossos ids.
  }[];
  total: number;
  formaPagamento?: string;
  // true = pago online/antecipado (PIX online, cartão online, carteira) → NÃO é "a
  // pagar". Quando indefinido, o ingest assume pagamento na entrega (dinheiro).
  pago?: boolean;
  // ===== Dinheiro separado por origem (mig 241) =====
  // Preenchidos pelos adaptadores que recebem o detalhe do canal. Quem não recebe deixa
  // undefined — o ingest então mantém o comportamento antigo, sem inventar número.
  valorBruto?: number; // itens a preço cheio, antes de desconto
  descontos?: DescontoCanal[];
  pagamentos?: PagamentoCanal[];
  taxaEntregaDono?: 'loja' | 'marketplace';
  valorPagoCliente?: number;
  taxasExtras?: TaxaExtraCanal[];
}

// Taxa que o cliente paga mas NÃO é receita de produto: gorjeta do garçom (repassada a ele)
// e taxa de serviço do pagamento online. Entra no total do pedido e precisa sair do bruto.
export interface TaxaExtraCanal {
  tipo: string; // código cru do canal ('waiter_tip', 'addition_pol'…)
  rotulo: string;
  valor: number;
}

// Um desconto como o canal informou. `quemBanca` é o campo que decide tudo: bancado pela
// LOJA sai do bolso do lojista; bancado pelo MARKETPLACE volta no repasse semanal. Quando o
// canal não diz, fica 'indefinido' — nunca chutar, senão o faturamento mente.
export interface DescontoCanal {
  origem: 'fidelidade' | 'cupom' | 'promocao' | 'cashback' | 'frete' | 'manual' | 'outro';
  rotulo: string; // como o canal chamou (ex.: "fidelidade") — preserva o original
  valor: number;
  alvo?: 'CART' | 'ITEM' | 'DELIVERY_FEE' | string;
  quemBanca: 'loja' | 'marketplace' | 'indefinido';
  campanha?: string;
}

export interface PagamentoCanal {
  codigo?: string; // código cru do canal (ex.: 'ifood-online-pix-payin')
  rotulo: string; // pt-BR p/ exibir
  valor: number;
  prepago: boolean; // true = já pago online (não é "a pagar" na entrega)
  troco?: number | null;
  bandeira?: string;
}

// Classifica o desconto pela ETIQUETA que o canal mandou. O texto varia por plataforma, e
// errar aqui joga o custo no balde errado — por isso casa por palavra-chave e cai em
// 'outro' quando não reconhece (em vez de adivinhar).
export function classificarDesconto(tag: any): DescontoCanal['origem'] {
  const bruto = String(tag ?? '').trim();
  const t = bruto.toLowerCase();
  if (!t) return 'outro';
  // "Desconto via PDV" (tag oficial da Anota Aí) = o operador abateu na mão. Não é programa:
  // é decisão de alguém no balcão, e por isso merece balde próprio (vira trilha de auditoria).
  if (/via pdv|no pdv|manual|operador|gerente/.test(t)) return 'manual';
  if (/fidel|loyal|clube|club|ponto|point|selo|stamp/.test(t)) return 'fidelidade';
  if (/cashback|volta|reembols/.test(t)) return 'cashback';
  if (/cupom|coupon|voucher|promocode/.test(t)) return 'cupom';
  if (/frete|delivery|entrega|shipping/.test(t)) return 'frete';
  if (/promo|desconto|discount|oferta|campanha|campaign/.test(t)) return 'promocao';
  // A Anota Aí documenta que, em cupom, a TAG É O PRÓPRIO CÓDIGO ("CUPOMDENATAL", "NATAL10").
  // Heurística de último recurso: token único, sem espaço, em CAIXA ALTA, com dígito ou 4+
  // letras → é código de cupom. O rótulo original fica guardado de qualquer forma.
  if (/^[A-Z0-9][A-Z0-9._-]{3,}$/.test(bruto)) return 'cupom';
  return 'outro';
}

// Normaliza a forma de pagamento de cada canal para pt-BR (é o que o card mostra).
// Aceita os códigos crus das plataformas ("money", "credit"…) e devolve rótulo pt-BR.
const FORMA_PT: Record<string, string> = {
  money: 'Dinheiro', cash: 'Dinheiro', dinheiro: 'Dinheiro',
  credit: 'Cartão de crédito', credit_card: 'Cartão de crédito', creditcard: 'Cartão de crédito',
  cartao_credito: 'Cartão de crédito', 'crédito': 'Cartão de crédito',
  debit: 'Cartão de débito', debit_card: 'Cartão de débito', cartao_debito: 'Cartão de débito',
  'débito': 'Cartão de débito',
  cartao: 'Cartão', 'cartão': 'Cartão', card: 'Cartão', pos: 'Cartão (maquininha)',
  pix: 'Pix',
  meal_voucher: 'Vale-refeição', food_voucher: 'Vale-alimentação', voucher: 'Vale',
  vr: 'Vale-refeição', va: 'Vale-alimentação',
  online: 'Pago online', prepaid: 'Pago online', wallet: 'Pago online', digital_wallet: 'Pago online',
};
export function formaPtBr(v: any): string {
  const k = String(v ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!k) return 'Não informado';
  if (FORMA_PT[k]) return FORMA_PT[k];
  const s = String(v).trim();
  return s.charAt(0).toUpperCase() + s.slice(1); // fallback: capitaliza o rótulo cru
}

// Mapeia um pedido do iFood (payload da API de pedidos) para o modelo interno.
export function adaptarIfood(raw: any): PedidoNormalizado {
  const itens = (raw?.items ?? []).map((it: any) => {
    const opts = (it.options ?? []).map((o: any) => o.name).filter(Boolean);
    return {
      codigo: it.externalCode ?? it.uniqueId ?? undefined,
      descricao: it.name ?? 'Item',
      quantidade: Number(it.quantity) || 1,
      // `totalPrice` é a linha COM complementos (doc do iFood: "preço total (item +
      // complementos)", e é o que soma em total.subTotal). `unitPrice` sozinho perdia os
      // adicionais e o item entrava no caixa abaixo do que vendeu.
      precoUnitario: (() => {
        const qtd = Number(it.quantity) || 1;
        const linha = Number(it.totalPrice);
        if (Number.isFinite(linha) && linha > 0) return Number((linha / qtd).toFixed(2));
        // Sem totalPrice: base + adição + complementos, na fórmula da própria doc.
        const base = Number(it.unitPrice ?? it.price) || 0;
        const add = Number(it.addition) || 0;
        const compl = (Number(it.optionsPrice) || 0) / qtd;
        return Number((base + add + compl).toFixed(2));
      })(),
      observacao: it.observations || undefined, // observação real do cliente
      complementos: opts.join(' · ') || undefined, // complementos (não é observação)
    };
  });
  const tipo =
    String(raw?.orderType ?? 'DELIVERY').toUpperCase() === 'TAKEOUT'
      ? 'retirada'
      : 'entrega';
  // Pagamento iFood: payments.pending = valor a receber na entrega (dinheiro);
  // methods[].type = PREPAID/ONLINE (pago no app) vs OFFLINE/PENDING (na entrega).
  const pay: any = raw?.payments ?? {};
  const metodo: any = pay?.methods?.[0] ?? (Array.isArray(pay) ? pay[0] : {}) ?? {};
  const pendente = pay?.pending ?? pay?.pendingAmount;
  const tipoPg = String(metodo?.type ?? '').toUpperCase();
  const pago =
    pendente != null ? Number(pendente) <= 0 : tipoPg === 'PREPAID' || tipoPg === 'ONLINE';
  // ===== Dinheiro detalhado (mig 241) =====
  // benefits[] é o ÚNICO lugar onde o iFood diz QUEM BANCOU o desconto, e é o dado que
  // permite conferir o repasse semanal. A regra é da própria doc do iFood:
  //   MERCHANT              → DESCONTO (sai do bolso da loja)
  //   IFOOD/EXTERNAL/CHAIN  → PAGAMENTO (o iFood repassa o valor à loja)
  // Um mesmo benefit pode ser CO-PATROCINADO, então cada patrocinador vira uma linha —
  // somar tudo junto perderia exatamente a separação que interessa.
  const descontos: DescontoCanal[] = [];
  for (const b of raw?.benefits ?? []) {
    const alvo = b?.target ? String(b.target) : undefined;
    const campanha = b?.campaign?.name ? String(b.campaign.name) : undefined;
    const patrocinios = Array.isArray(b?.sponsorshipValues) ? b.sponsorshipValues : [];
    // Sem detalhe de patrocínio não dá para afirmar quem pagou → 'indefinido'.
    if (!patrocinios.length) {
      const v = Number(b?.value) || 0;
      if (v > 0)
        descontos.push({
          origem: classificarDesconto(campanha),
          rotulo: campanha ?? 'benefício',
          valor: v,
          alvo,
          quemBanca: 'indefinido',
          campanha,
        });
      continue;
    }
    for (const s of patrocinios) {
      const v = Number(s?.value) || 0;
      if (v <= 0) continue; // o iFood manda patrocinador com 0 — não é desconto
      const quem = String(s?.name ?? '').toUpperCase();
      descontos.push({
        origem: classificarDesconto(campanha ?? s?.description),
        // Preserva o patrocinador no rótulo: é o que separa "promoção minha" de
        // "incentivo do iFood" no relatório, já que não existe campo de tipo.
        rotulo: `${quem || 'PATROCINADOR'}${campanha ? ` · ${campanha}` : ''}`,
        valor: v,
        alvo,
        quemBanca: quem === 'MERCHANT' ? 'loja' : quem ? 'marketplace' : 'indefinido',
        campanha,
      });
    }
  }

  // additionalFees do iFood são RECEITA DO IFOOD cobrada do cliente (serviço, intermediação).
  // A doc é explícita: "não devem ser adicionadas à nota fiscal". Não é receita da loja.
  const extraFees = Number(raw?.total?.additionalFees) || 0;
  const taxasExtras: TaxaExtraCanal[] = extraFees > 0
    ? [{ tipo: 'ifood_additional_fees', rotulo: 'Taxas do iFood', valor: extraFees }]
    : [];

  const pagamentos: PagamentoCanal[] = (pay?.methods ?? []).map((m: any) => {
    const t = String(m?.type ?? '').toUpperCase();
    return {
      codigo: m?.method ? String(m.method) : undefined,
      rotulo: formaPtBr(m?.method),
      valor: Number(m?.value) || 0,
      prepago: t === 'ONLINE' || t === 'PREPAID',
      // changeFor = a nota com que o cliente vai pagar (o troco sai daí), não o troco.
      troco: m?.cash?.changeFor != null ? Number(m.cash.changeFor) : null,
      bandeira: m?.card?.brand ?? m?.wallet?.name ?? undefined,
    };
  });

  // subTotal é o somatório dos itens — o "valor real do produto" que faltava.
  const subTotal = Number(raw?.total?.subTotal);
  const pagoCliente = Number(raw?.total?.orderAmount ?? raw?.totalAmount) || 0;
  // Quem entrega decide de quem é a taxa: com logística do iFood, o frete cobrado do cliente
  // não é receita da loja (o custo do entregador vem como débito no repasse).
  const entregaPor = String(raw?.delivery?.deliveredBy ?? '').toUpperCase();

  return {
    externalId: raw?.id ? String(raw.id) : undefined,
    displayId: raw?.displayId ? String(raw.displayId) : undefined,
    clienteNome: raw?.customer?.name,
    clienteTelefone: raw?.customer?.phone?.number ?? raw?.customer?.phone,
    tipo,
    endereco: raw?.delivery?.deliveryAddress?.formattedAddress,
    itens,
    total: pagoCliente,
    formaPagamento: formaPtBr(metodo?.method ?? (pago ? 'online' : 'money')),
    pago,
    valorBruto: Number.isFinite(subTotal) ? subTotal : undefined,
    descontos: descontos.length ? descontos : undefined,
    pagamentos: pagamentos.length ? pagamentos : undefined,
    taxaEntregaDono: entregaPor === 'MERCHANT' ? 'loja' : entregaPor ? 'marketplace' : undefined,
    valorPagoCliente: pagoCliente,
    taxasExtras: taxasExtras.length ? taxasExtras : undefined,
  };
}

// Retorna o INÍCIO da janela de entrega quando o pedido do iFood é AGENDADO
// (orderTiming === 'SCHEDULED'); null se for imediato. Usado para NÃO despachar
// antes da hora marcada (regra do iFood p/ pedidos agendados). Lê os vários
// caminhos possíveis do payload (schedule.deliveryDateTimeStart etc.).
export function agendamentoIfood(raw: any): Date | null {
  const timing = String(raw?.orderTiming ?? raw?.timing ?? '').toUpperCase();
  // O iFood expõe a janela do agendado em `schedule` e/ou `scheduling` (ex.:
  // scheduling.from / .to). Só é agendado quando orderTiming === 'SCHEDULED'.
  const sched = raw?.schedule ?? raw?.scheduling ?? raw?.scheduled ?? {};
  const inicio =
    sched?.deliveryDateTimeStart ??
    sched?.deliveryDateTimeStartLocal ??
    sched?.from ??
    sched?.deliveryDateTime ??
    raw?.delivery?.deliveryDateTime ??
    null;
  if (timing !== 'SCHEDULED') return null;
  if (!inicio) return null;
  const d = new Date(inicio);
  return isNaN(d.getTime()) ? null : d;
}

// Canal genérico: já recebe no formato interno (ou próximo dele).
export function adaptarGenerico(raw: any): PedidoNormalizado {
  return {
    externalId: raw?.externalId ?? raw?.id,
    displayId: raw?.displayId,
    clienteNome: raw?.clienteNome ?? raw?.cliente,
    clienteTelefone: raw?.clienteTelefone,
    tipo: raw?.tipo === 'retirada' ? 'retirada' : 'entrega',
    endereco: raw?.endereco,
    itens: (raw?.itens ?? []).map((it: any) => ({
      produtoId: it.produtoId,
      codigo: it.codigo,
      descricao: it.descricao ?? it.nome ?? 'Item',
      quantidade: Number(it.quantidade) || 1,
      precoUnitario: Number(it.precoUnitario ?? it.preco) || 0,
      observacao: it.observacao,
      opcaoIds: Array.isArray(it.opcaoIds) ? it.opcaoIds : undefined, // origem interna (cardápio/totem)
    })),
    total: Number(raw?.total) || 0,
    formaPagamento: formaPtBr(raw?.formaPagamento ?? (raw?.pago ? 'online' : 'money')),
    pago: raw?.pago != null ? Boolean(raw.pago) : undefined,
  };
}

// Open Delivery (Abrasel): mapeia o pedido do padrão aberto → modelo interno.
// Cobre marketplaces que falam Open Delivery (ex.: Cardápio Web).
export function adaptarOpenDelivery(raw: any): PedidoNormalizado {
  const itens = (raw?.items ?? []).map((it: any) => {
    const opts = (it.options ?? it.optionsGroups ?? [])
      .flatMap((g: any) => (g?.options ? g.options : [g]))
      .map((o: any) => o?.name)
      .filter(Boolean);
    return {
      codigo: it.externalCode ?? it.sku ?? undefined,
      descricao: it.name ?? 'Item',
      quantidade: Number(it.quantity) || 1,
      precoUnitario: Number(it.unitPrice?.value ?? it.unitPrice ?? it.price) || 0,
      observacao: (it.observation ?? it.observations) || undefined,
      complementos: opts.join(' · ') || undefined,
    };
  });
  const tipoRaw = String(raw?.type ?? raw?.orderType ?? 'DELIVERY').toUpperCase();
  const tipo = tipoRaw === 'TAKEOUT' || tipoRaw === 'TAKEAWAY' ? 'retirada' : 'entrega';
  const addr = raw?.delivery?.deliveryAddress ?? raw?.delivery?.address;
  const endereco =
    addr?.formattedAddress ||
    [addr?.street, addr?.number, addr?.neighborhood, addr?.city].filter(Boolean).join(', ') ||
    undefined;
  return {
    externalId: raw?.id ? String(raw.id) : undefined,
    displayId: raw?.displayId ? String(raw.displayId) : raw?.orderExternalCode,
    clienteNome: raw?.customer?.name,
    clienteTelefone: raw?.customer?.phone?.number ?? raw?.customer?.phoneNumber ?? raw?.customer?.phone,
    tipo,
    endereco,
    itens,
    total: Number(raw?.total?.orderAmount?.value ?? raw?.total?.orderAmount ?? raw?.totalAmount) || 0,
    ...(() => {
      const m: any = raw?.payments?.methods?.[0] ?? raw?.payments?.[0] ?? {};
      const t = String(m?.type ?? m?.prepaid ?? '').toUpperCase();
      const pago = m?.prepaid === true || t === 'PREPAID' || t === 'ONLINE' || t === 'TRUE';
      return { formaPagamento: formaPtBr(m?.method ?? (pago ? 'online' : 'money')), pago };
    })(),
  };
}

// Cardápio Web (API Aberta nativa): mapeia o objeto Order (docs.cardapioweb.com)
// → modelo interno. De-para de item por CÓDIGO/SKU: usamos o código PDV que o
// item carrega no CW (a confirmar o campo exato com um pedido real do Sandbox);
// item_id é o id interno do CW e NÃO casa com o produto do Regem.
export function adaptarCardapioWeb(raw: any): PedidoNormalizado {
  const itens = (raw?.items ?? []).map((it: any) => {
    const opts = (it.options ?? [])
      .map((o: any) => (o?.quantity > 1 ? `${o.quantity}x ${o.name}` : o?.name))
      .filter(Boolean);
    return {
      // De-para: código PDV (external_code) se a loja preencheu; senão o item_id
      // do Cardápio Web prefixado com "cw" — o importador de catálogo usa a mesma
      // regra, então o item casa com o produto do Regem sem cadastro manual.
      codigo: it.external_code ?? (it.item_id != null ? 'cw' + it.item_id : undefined),
      descricao: it.name ?? 'Item',
      quantidade: Number(it.quantity) || 1,
      precoUnitario: Number(it.unit_price ?? it.total_price) || 0,
      observacao: it.observation || undefined,
      complementos: opts.join(' · ') || undefined,
    };
  });
  const t = String(raw?.order_type ?? 'delivery').toLowerCase();
  const tipo = t === 'delivery' ? 'entrega' : 'retirada'; // takeout/onsite/closed_table → retirada
  const a = raw?.delivery_address ?? {};
  const endereco =
    [a.street, a.number, a.neighborhood, a.city, a.state].filter(Boolean).join(', ') || undefined;
  const pgto = (raw?.payments ?? [])[0] ?? {};
  return {
    externalId: raw?.id != null ? String(raw.id) : undefined,
    displayId: raw?.display_id != null ? String(raw.display_id) : undefined,
    clienteNome: raw?.customer?.name,
    clienteTelefone: raw?.customer?.phone,
    tipo,
    endereco,
    itens,
    total: Number(raw?.total) || 0,
    formaPagamento: formaPtBr(pgto.payment_method ?? (pgto.prepaid || pgto.paid || pgto.online ? 'online' : 'money')),
    pago: Boolean(pgto.prepaid ?? pgto.paid ?? pgto.online ?? (String(pgto.type ?? '').toUpperCase() === 'PREPAID')),
  };
}

// 99Food / DiDi Food (openapi.didi-food.com): mapeia o OrderModel da API própria
// do DiDi → modelo interno. Preços vêm em CENTAVOS (int) → dividimos por 100.
// De-para de item por `app_item_id` (o código PDV que subimos no menu do 99food).
// O externalId vem como STRING (order_id 64-bit — nunca convertido a number).
export function adaptarDidiFood(raw: any): PedidoNormalizado {
  const itens = (raw?.order_items ?? []).map((it: any) => {
    const subs = (it.sub_item_list ?? [])
      .map((s: any) => (Number(s?.amount) > 1 ? `${s.amount}x ${s.name}` : s?.name))
      .filter(Boolean);
    const qtd = Number(it.amount) || 1;
    const unitCents = Number(it.sku_price ?? (Number(it.total_price) || 0) / qtd) || 0;
    return {
      codigo: it.app_item_id ?? undefined,
      descricao: it.name ?? 'Item',
      quantidade: qtd,
      precoUnitario: unitCents / 100,
      observacao: it.remark || undefined,
      complementos: subs.join(' · ') || undefined,
    };
  });
  const addr = raw?.receive_address ?? {};
  const endereco =
    [addr.poi_address, addr.house_number, addr.city].filter(Boolean).join(', ') || undefined;
  const tel = addr.phone
    ? `${addr.calling_code ? '+' + addr.calling_code + ' ' : ''}${addr.phone}`
    : undefined;
  const totalCents =
    Number(
      raw?.price?.customer_need_paying_money ??
        raw?.price?.real_pay_price ??
        raw?.price?.real_price ??
        raw?.price?.order_price,
    ) || 0;
  // pay_type: 1 online · 2 dinheiro · 3 pos(cartão) · 4 wallet(online).
  const PAY: Record<number, string> = { 1: 'online', 2: 'money', 3: 'cartao', 4: 'online' };
  const payType = Number(raw?.pay_type);
  return {
    externalId: raw?.order_id != null ? String(raw.order_id) : undefined,
    displayId: raw?.order_index != null ? String(raw.order_index) : undefined,
    clienteNome: addr.name ?? addr.first_name,
    clienteTelefone: tel,
    tipo: 'entrega',
    endereco,
    itens,
    total: totalCents / 100,
    formaPagamento: formaPtBr(PAY[payType] ?? 'online'),
    pago: payType === 1 || payType === 4, // online/wallet = pago; dinheiro/pos = na entrega
  };
}

// Anota Aí (api-parceiros.anota.ai): mapeia o Order Model → modelo interno. O objeto
// pode vir dentro de `info` (PING - GET ORDER: { success, info: {...} }) ou já ser o
// pedido. Preços em REAIS (não centavos). De-para de item por `externalId` (código PDV).
export function adaptarAnotaAi(raw: any): PedidoNormalizado {
  const o = raw?.info ?? raw ?? {};
  const itens = (o.items ?? []).map((it: any) => {
    const subs = (it.subItems ?? [])
      .map((s: any) => (Number(s?.quantity) > 1 ? `${s.quantity}x ${s.name}` : s?.name))
      .filter(Boolean);
    const qtd = Number(it.quantity) || 1;
    return {
      codigo: it.externalId ?? it.internalId ?? undefined,
      descricao: it.name ?? 'Item',
      quantidade: qtd,
      // `total` é a linha COM os adicionais (payload real: price 13 + bacon 2,50 + ovo 2,00
      // = total 17,50). Usar `price` gravava só a base e perdia os adicionais — o item
      // entrava no caixa abaixo do que de fato vendeu. Prefere `total`; cai em `price`
      // (mais os subitens) só quando a plataforma não mandar o total da linha.
      // A doc da Anota Aí nomeia os campos como `amount`/`totalPrice`; o payload real de
      // produção manda `price`/`total`. Aceita os dois para não depender da versão.
      precoUnitario:
        Number(it.total ?? it.totalPrice) > 0
          ? Number((Number(it.total ?? it.totalPrice) / qtd).toFixed(2))
          : Number(
              (
                (Number(it.price ?? it.amount) || 0) +
                (it.subItems ?? []).reduce(
                  (a: number, s: any) => a + (Number(s?.total ?? s?.totalPrice ?? s?.price ?? s?.amount) || 0),
                  0,
                )
              ).toFixed(2),
            ),
      observacao: (it.observation ?? it.obs ?? it.note ?? it.comment) || undefined,
      complementos: subs.join(' · ') || undefined,
    };
  });
  // type: DELIVERY → entrega · TAKE (retirada no local) / LOCAL (consumo no local) → retirada
  const tipo = String(o.type ?? 'DELIVERY').toUpperCase() === 'DELIVERY' ? 'entrega' : 'retirada';
  const a = o.deliveryAddress ?? {};
  const endereco =
    a.formattedAddress ||
    [a.streetName, a.streetNumber, a.neighborhood, a.city, a.state].filter(Boolean).join(', ') ||
    undefined;
  const pgto = (o.payments ?? [])[0] ?? {};
  const eid = o._id ?? o.id;
  // Anota Aí: pagamento online quando o pedido já vem pago (flag online/prepaid) ou
  // quando o método é PIX/cartão online. Dinheiro = na entrega.
  const online = Boolean(
    pgto.online ?? pgto.prepaid ?? pgto.paid ?? o.paidOnline ?? o.isPaid ?? o.online,
  );

  // ===== Dinheiro detalhado (mig 241) =====
  // A Anota Aí manda `discounts[]` com a ETIQUETA do programa: {tag:'fidelidade',
  // amount:32.5, target:'CART'}. Sem ler isso, um resgate de fidelidade que zera o pedido
  // chega ao Regem como um pedido de R$0,00 e o custo do programa some.
  // QUEM BANCA: a Anota Aí é o canal PRÓPRIO da loja (white-label) — cupom, fidelidade e
  // cashback ali saem do bolso dela. MAS `salesChannel` pode vir 'ifood' (pedido do iFood
  // importado pela integração deles); nesse caso não dá para afirmar quem patrocinou, e
  // chutar 'loja' viraria custo falso — então fica 'indefinido' e o ingest trata com
  // prudência. Só afirmamos 'loja' quando o pedido nasceu mesmo na Anota Aí.
  const daCasa = String(o.salesChannel ?? 'anotaai').toLowerCase() !== 'ifood';
  const descontos: DescontoCanal[] = (o.discounts ?? [])
    .map((d: any) => ({
      origem: classificarDesconto(d?.tag ?? d?.description ?? d?.name),
      rotulo: String(d?.tag ?? d?.description ?? d?.name ?? 'desconto'),
      valor: Number(d?.amount ?? d?.value) || 0,
      alvo: d?.target ? String(d.target) : undefined,
      quemBanca: (daCasa ? 'loja' : 'indefinido') as DescontoCanal['quemBanca'],
    }))
    .filter((d: DescontoCanal) => d.valor > 0);

  // payments[] traz muito mais do que a flag de pago: valor por método (pagamento dividido),
  // `changeFor` (o TROCO, que hoje se perde e o entregador sai sem saber) e `cardSelected`
  // (a bandeira). Guardamos o detalhe inteiro.
  const pagamentos: PagamentoCanal[] = (o.payments ?? []).map((p: any) => ({
    codigo: p?.code ? String(p.code) : undefined,
    rotulo: formaPtBr(p?.name ?? p?.code),
    valor: Number(p?.value) || 0,
    prepago: Boolean(p?.prepaid ?? p?.online ?? p?.paid),
    troco: p?.changeFor != null && Number(p.changeFor) > 0 ? Number(p.changeFor) : null,
    bandeira: p?.cardSelected ? String(p.cardSelected) : undefined,
  }));

  // Gorjeta do garçom / taxa de serviço do pagamento online. Entram no total do pedido mas
  // não são produto — somá-las ao faturamento infla a margem e tira a base do rateio do garçom.
  const taxasExtras: TaxaExtraCanal[] = (o.additionalFees ?? [])
    .map((f: any) => ({
      tipo: String(f?.type ?? 'outro'),
      rotulo: String(f?.description ?? f?.type ?? 'Taxa'),
      valor: Number(f?.value) || 0,
    }))
    .filter((f: TaxaExtraCanal) => f.valor > 0);

  const taxa = Number(o.deliveryFee) || 0;
  const somaDesc = descontos.reduce((a, d) => a + d.valor, 0);
  const somaExtras = taxasExtras.reduce((a, f) => a + f.valor, 0);
  const pagoCliente = Number(o.total) || 0;
  // Bruto dos PRODUTOS = o que o cliente pagou + o que foi abatido − entrega − taxas extras.
  // Confirmado nos payloads oficiais: itens 10 + gorjeta 1 = total 11 → bruto 10.
  // São todos valores DECLARADOS pela plataforma; não é estimativa nossa.
  const bruto = Number((pagoCliente + somaDesc - taxa - somaExtras).toFixed(2));

  return {
    externalId: eid != null ? String(eid) : undefined,
    displayId: o.shortReference != null ? String(o.shortReference) : undefined,
    clienteNome: o.customer?.name,
    clienteTelefone: o.customer?.phone,
    tipo,
    endereco,
    itens,
    total: pagoCliente,
    formaPagamento: formaPtBr(pgto.name ?? pgto.code ?? (online ? 'online' : 'money')),
    pago: online,
    valorBruto: bruto >= 0 ? bruto : undefined,
    descontos: descontos.length ? descontos : undefined,
    pagamentos: pagamentos.length ? pagamentos : undefined,
    // A taxa da Anota Aí é cobrada do cliente e compõe o pedido → é receita da LOJA.
    taxaEntregaDono: taxa > 0 ? 'loja' : undefined,
    valorPagoCliente: pagoCliente,
    taxasExtras: taxasExtras.length ? taxasExtras : undefined,
  };
}

// Início da janela de um pedido AGENDADO do Anota Aí (schedule_order.date, em UTC-0);
// null se imediato. Usado p/ não despachar antes da hora (igual ao iFood agendado).
export function agendamentoAnotaAi(raw: any): Date | null {
  const o = raw?.info ?? raw ?? {};
  const inicio = o?.schedule_order?.date;
  if (!inicio) return null;
  const d = new Date(inicio);
  return isNaN(d.getTime()) ? null : d;
}

// Mapeia um status EXTERNO (string livre, PT/EN, de qualquer plataforma) para o
// estágio do fluxo do Regem. Lenient por palavra-chave — robusto a valores que a
// doc não documenta. Retorna null quando é "novo/confirmado/em produção" (o pedido
// segue o fluxo normal de ingestão) ou quando não reconhece.
export function mapStatusExterno(
  valor: unknown,
): 'pronto' | 'despachado' | 'concluido' | 'cancelado' | null {
  const s = String(valor ?? '').toLowerCase().trim();
  if (!s) return null;
  if (/cancel|reject|negad|denied|recus|declin/.test(s)) return 'cancelado';
  if (/deliver(ed)?|conclu|finish|finaliz|complet|entreg|done/.test(s)) return 'concluido';
  if (/rota|route|dispatch|transit|saiu|out.?for|shipping|a.?caminho|em.?entrega/.test(s)) return 'despachado';
  if (/ready|pronto|prepared/.test(s)) return 'pronto';
  return null; // pending | confirmed | production | preparo → fluxo normal
}

export function adaptar(canal: string, raw: any): PedidoNormalizado {
  if (canal === 'ifood') return adaptarIfood(raw);
  if (canal === 'anotaai') return adaptarAnotaAi(raw);
  if (canal === 'open_delivery' || canal === 'delivery_direto') return adaptarOpenDelivery(raw);
  if (canal === 'cardapio_web') return adaptarCardapioWeb(raw);
  if (canal === '99food') return adaptarDidiFood(raw);
  return adaptarGenerico(raw);
}
