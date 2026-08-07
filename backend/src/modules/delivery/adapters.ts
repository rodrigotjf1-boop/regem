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
      precoUnitario: Number(it.unitPrice ?? it.price) || 0,
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
  return {
    externalId: raw?.id ? String(raw.id) : undefined,
    displayId: raw?.displayId ? String(raw.displayId) : undefined,
    clienteNome: raw?.customer?.name,
    clienteTelefone: raw?.customer?.phone?.number ?? raw?.customer?.phone,
    tipo,
    endereco: raw?.delivery?.deliveryAddress?.formattedAddress,
    itens,
    total: Number(raw?.total?.orderAmount ?? raw?.totalAmount) || 0,
    formaPagamento: formaPtBr(metodo?.method ?? (pago ? 'online' : 'money')),
    pago,
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
      precoUnitario: Number(it.price ?? (Number(it.total) || 0) / qtd) || 0,
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
  return {
    externalId: eid != null ? String(eid) : undefined,
    displayId: o.shortReference != null ? String(o.shortReference) : undefined,
    clienteNome: o.customer?.name,
    clienteTelefone: o.customer?.phone,
    tipo,
    endereco,
    itens,
    total: Number(o.total) || 0,
    formaPagamento: formaPtBr(pgto.name ?? pgto.code ?? (online ? 'online' : 'money')),
    pago: online,
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
