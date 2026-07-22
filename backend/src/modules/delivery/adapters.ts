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
    observacao?: string;
  }[];
  total: number;
  formaPagamento?: string;
}

// Mapeia um pedido do iFood (payload da API de pedidos) para o modelo interno.
export function adaptarIfood(raw: any): PedidoNormalizado {
  const itens = (raw?.items ?? []).map((it: any) => {
    const opts = (it.options ?? []).map((o: any) => o.name).filter(Boolean);
    const obs = [it.observations, ...opts].filter(Boolean).join(' · ') || undefined;
    return {
      codigo: it.externalCode ?? it.uniqueId ?? undefined,
      descricao: it.name ?? 'Item',
      quantidade: Number(it.quantity) || 1,
      precoUnitario: Number(it.unitPrice ?? it.price) || 0,
      observacao: obs,
    };
  });
  const tipo =
    String(raw?.orderType ?? 'DELIVERY').toUpperCase() === 'TAKEOUT'
      ? 'retirada'
      : 'entrega';
  return {
    externalId: raw?.id ? String(raw.id) : undefined,
    displayId: raw?.displayId ? String(raw.displayId) : undefined,
    clienteNome: raw?.customer?.name,
    clienteTelefone: raw?.customer?.phone?.number ?? raw?.customer?.phone,
    tipo,
    endereco: raw?.delivery?.deliveryAddress?.formattedAddress,
    itens,
    total: Number(raw?.total?.orderAmount ?? raw?.totalAmount) || 0,
    formaPagamento: raw?.payments?.methods?.[0]?.method ?? 'online',
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
    })),
    total: Number(raw?.total) || 0,
    formaPagamento: raw?.formaPagamento ?? 'online',
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
    const obs = [it.observation ?? it.observations, ...opts].filter(Boolean).join(' · ') || undefined;
    return {
      codigo: it.externalCode ?? it.sku ?? undefined,
      descricao: it.name ?? 'Item',
      quantidade: Number(it.quantity) || 1,
      precoUnitario: Number(it.unitPrice?.value ?? it.unitPrice ?? it.price) || 0,
      observacao: obs,
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
    formaPagamento: raw?.payments?.methods?.[0]?.method ?? raw?.payments?.[0]?.method ?? 'online',
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
    const obs = [it.observation, ...opts].filter(Boolean).join(' · ') || undefined;
    return {
      // De-para: código PDV (external_code) se a loja preencheu; senão o item_id
      // do Cardápio Web prefixado com "cw" — o importador de catálogo usa a mesma
      // regra, então o item casa com o produto do Regem sem cadastro manual.
      codigo: it.external_code ?? (it.item_id != null ? 'cw' + it.item_id : undefined),
      descricao: it.name ?? 'Item',
      quantidade: Number(it.quantity) || 1,
      precoUnitario: Number(it.unit_price ?? it.total_price) || 0,
      observacao: obs,
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
    formaPagamento: pgto.payment_method ?? 'online',
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
    const obs = [it.remark, ...subs].filter(Boolean).join(' · ') || undefined;
    const qtd = Number(it.amount) || 1;
    const unitCents = Number(it.sku_price ?? (Number(it.total_price) || 0) / qtd) || 0;
    return {
      codigo: it.app_item_id ?? undefined,
      descricao: it.name ?? 'Item',
      quantidade: qtd,
      precoUnitario: unitCents / 100,
      observacao: obs,
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
  const PAY: Record<number, string> = { 1: 'online', 2: 'dinheiro', 3: 'cartão', 4: 'online' };
  return {
    externalId: raw?.order_id != null ? String(raw.order_id) : undefined,
    displayId: raw?.order_index != null ? String(raw.order_index) : undefined,
    clienteNome: addr.name ?? addr.first_name,
    clienteTelefone: tel,
    tipo: 'entrega',
    endereco,
    itens,
    total: totalCents / 100,
    formaPagamento: PAY[Number(raw?.pay_type)] ?? 'online',
  };
}

export function adaptar(canal: string, raw: any): PedidoNormalizado {
  if (canal === 'ifood') return adaptarIfood(raw);
  if (canal === 'open_delivery') return adaptarOpenDelivery(raw);
  if (canal === 'cardapio_web') return adaptarCardapioWeb(raw);
  if (canal === '99food') return adaptarDidiFood(raw);
  return adaptarGenerico(raw);
}
