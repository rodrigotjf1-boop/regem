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
// `target` do benefit do iFood — enum documentado, ao contrário de campaign.name (texto
// livre, que chega como código interno tipo "FD_DESPIT_27D7135"). null = não reconhecido,
// e aí o chamador tenta pelo nome da campanha.
function classificarAlvoIfood(alvo?: string): DescontoCanal['origem'] | null {
  switch (String(alvo ?? '').toUpperCase()) {
    case 'DELIVERY_FEE': return 'frete';
    case 'ITEM':
    case 'PROGRESSIVE_DISCOUNT_ITEM': return 'promocao'; // desconto no item / combo progressivo
    case 'CART': return 'cupom'; // desconto no subtotal do carrinho
    default: return null;
  }
}

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
        // Classifica pelo `target`, que é ENUM DOCUMENTADO (CART / ITEM / DELIVERY_FEE /
        // PROGRESSIVE_DISCOUNT_ITEM). O `campaign.name` do iFood é texto livre e vem como
        // código interno opaco ("FD_DESPIT_27D7135_a63_647"), então classificar por ele
        // jogava tudo em "outro". O nome continua guardado como rótulo/campanha, que é o
        // que permite agrupar por campanha específica no relatório.
        origem: classificarAlvoIfood(alvo) ?? classificarDesconto(campanha ?? s?.description),
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
  // A doc é explícita: "não devem ser adicionadas à nota fiscal" — logo não é receita da loja
  // e não pode entrar no bruto. O array traz o detalhe (type/description); `total.additionalFees`
  // é só o somatório. Guardamos o detalhe quando vier, para o relatório nomear cada taxa.
  const lista = Array.isArray(raw?.additionalFees) ? raw.additionalFees : [];
  const taxasExtras: TaxaExtraCanal[] = lista
    .map((f: any) => ({
      tipo: String(f?.type ?? 'ifood_fee'),
      rotulo: String(f?.description ?? f?.fullDescription ?? f?.type ?? 'Taxa do iFood'),
      valor: Number(f?.value) || 0,
    }))
    .filter((f: TaxaExtraCanal) => f.valor > 0);
  // Sem o array (payload antigo), cai no somatório para não perder o valor.
  const somaFees = Number(raw?.total?.additionalFees) || 0;
  if (!taxasExtras.length && somaFees > 0)
    taxasExtras.push({ tipo: 'ifood_additional_fees', rotulo: 'Taxas do iFood', valor: somaFees });

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
    // ===== Detalhe por origem (mig 241) =====
    // O canal PRÓPRIO (cardápio/totem) é quem calcula os próprios descontos, então ele
    // manda o detalhe pronto aqui — este adaptador só repassa. Quem não mandar continua
    // undefined, e o ingest não inventa nada.
    valorBruto: raw?.valorBruto != null ? Number(raw.valorBruto) : undefined,
    descontos: Array.isArray(raw?.descontos) && raw.descontos.length ? raw.descontos : undefined,
    pagamentos: Array.isArray(raw?.pagamentos) && raw.pagamentos.length ? raw.pagamentos : undefined,
    taxaEntregaDono:
      raw?.taxaEntregaDono === 'loja' || raw?.taxaEntregaDono === 'marketplace'
        ? raw.taxaEntregaDono
        : undefined,
    valorPagoCliente: raw?.valorPagoCliente != null ? Number(raw.valorPagoCliente) : undefined,
    taxasExtras:
      Array.isArray(raw?.taxasExtras) && raw.taxasExtras.length ? raw.taxasExtras : undefined,
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
      // Spec Open Delivery: totalPrice = quantity * (unitPrice + optionsPrice) — é a linha
      // COM os adicionais, e é o que soma em total.itemsPrice. unitPrice sozinho perdia os
      // complementos. A doc manda confiar no totalPrice recebido, não recalcular.
      precoUnitario: (() => {
        const qtd = Number(it.quantity) || 1;
        const linha = Number(it.totalPrice?.value ?? it.totalPrice);
        if (Number.isFinite(linha) && linha > 0) return Number((linha / qtd).toFixed(2));
        const base = Number(it.unitPrice?.value ?? it.unitPrice ?? it.price) || 0;
        const opc = Number(it.optionsPrice?.value ?? it.optionsPrice) || 0;
        return Number((base + opc).toFixed(2));
      })(),
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
  // ===== Dinheiro detalhado (mig 241) — spec Open Delivery v1.7.1 (Abrasel) =====
  // ARMADILHA do padrão: em `total.*`, `otherFees[].price` e `discounts[].amount` o valor é
  // um OBJETO Price {value,currency}; já em `payments.methods[].value` é número puro.
  const pv = (x: any) => Number(x?.value ?? x) || 0;

  // discounts[].sponsorshipValues[] diz QUEM BANCA, com rateio explícito:
  //   MERCHANT              → desconto da loja (sai do bolso dela)
  //   MARKETPLACE / CHAIN   → bancado por terceiro (volta no acerto)
  // O código do cupom vem em `discountCode` — é o único campo de rótulo que o padrão tem.
  const descontosOD: DescontoCanal[] = [];
  for (const d of raw?.discounts ?? []) {
    const alvo = d?.target ? String(d.target) : undefined;
    const patroc = Array.isArray(d?.sponsorshipValues) ? d.sponsorshipValues : [];
    if (!patroc.length) {
      const v = pv(d?.amount);
      if (v > 0) descontosOD.push({ origem: 'promocao', rotulo: 'desconto', valor: v, alvo, quemBanca: 'indefinido' });
      continue;
    }
    for (const s of patroc) {
      const v = pv(s?.amount);
      if (v <= 0) continue;
      const quem = String(s?.name ?? '').toUpperCase();
      const codigo = s?.discountCode ? String(s.discountCode) : undefined;
      descontosOD.push({
        origem: codigo ? 'cupom' : alvo === 'DELIVERY_FEE' ? 'frete' : 'promocao',
        rotulo: `${quem || 'PATROCINADOR'}${codigo ? ` · ${codigo}` : ''}`,
        valor: v,
        alvo,
        quemBanca: quem === 'MERCHANT' ? 'loja' : quem ? 'marketplace' : 'indefinido',
        campanha: codigo,
      });
    }
  }

  // otherFees[]: a taxa de ENTREGA tem dono declarado em `receivedBy` — e a doc é explícita
  // que é o destino ECONÔMICO final, não quem coletou o dinheiro. As demais (serviço,
  // gorjeta, pedido mínimo) não são receita de produto.
  const fees = raw?.otherFees ?? [];
  const feeEntrega = fees.find((f: any) => String(f?.type ?? '').toUpperCase() === 'DELIVERY_FEE');
  const recebedor = String(feeEntrega?.receivedBy ?? raw?.delivery?.deliveredBy ?? '').toUpperCase();
  const taxasOD: TaxaExtraCanal[] = fees
    .filter((f: any) => String(f?.type ?? '').toUpperCase() !== 'DELIVERY_FEE')
    .map((f: any) => ({
      tipo: String(f?.type ?? 'outro'),
      rotulo: String(f?.name ?? f?.type ?? 'Taxa'),
      valor: pv(f?.price),
    }))
    .filter((f: TaxaExtraCanal) => f.valor > 0);

  const metodos = raw?.payments?.methods ?? (Array.isArray(raw?.payments) ? raw.payments : []);
  const pagamentosOD: PagamentoCanal[] = metodos.map((m: any) => {
    const t = String(m?.type ?? '').toUpperCase();
    return {
      codigo: m?.method ? String(m.method) : undefined,
      rotulo: formaPtBr(m?.method),
      valor: Number(m?.value) || 0, // número puro neste ponto do padrão
      prepago: t === 'PREPAID' || t === 'ONLINE' || m?.prepaid === true,
      // changeFor = a nota com que o cliente paga (o troco sai daí), não o troco.
      troco: m?.changeFor != null && Number(m.changeFor) > 0 ? Number(m.changeFor) : null,
      bandeira: m?.brand ?? m?.methodInfo ?? undefined,
    };
  });

  const pagoClienteOD = pv(raw?.total?.orderAmount) || Number(raw?.totalAmount) || 0;
  const itemsPrice = raw?.total?.itemsPrice != null ? pv(raw.total.itemsPrice) : undefined;

  return {
    externalId: raw?.id ? String(raw.id) : undefined,
    displayId: raw?.displayId ? String(raw.displayId) : raw?.orderExternalCode,
    clienteNome: raw?.customer?.name,
    clienteTelefone: raw?.customer?.phone?.number ?? raw?.customer?.phoneNumber ?? raw?.customer?.phone,
    tipo,
    endereco,
    itens,
    total: pagoClienteOD,
    ...(() => {
      const m: any = metodos[0] ?? {};
      const t = String(m?.type ?? m?.prepaid ?? '').toUpperCase();
      const pago = m?.prepaid === true || t === 'PREPAID' || t === 'ONLINE' || t === 'TRUE';
      return { formaPagamento: formaPtBr(m?.method ?? (pago ? 'online' : 'money')), pago };
    })(),
    valorBruto: itemsPrice,
    descontos: descontosOD.length ? descontosOD : undefined,
    pagamentos: pagamentosOD.length ? pagamentosOD : undefined,
    taxaEntregaDono: recebedor === 'MERCHANT' ? 'loja' : recebedor ? 'marketplace' : undefined,
    valorPagoCliente: pagoClienteOD,
    taxasExtras: taxasOD.length ? taxasOD : undefined,
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
      // BUG corrigido: caía em `total_price` (o total da LINHA) sem dividir pela quantidade —
      // 3 unidades a R$20 (linha R$60) viravam R$60 cada, R$180 no caixa. Os outros canais
      // (99food e Anota Aí) já dividiam; este era o único fora do padrão.
      precoUnitario: (() => {
        const qtd = Number(it.quantity) || 1;
        const un = Number(it.unit_price);
        if (Number.isFinite(un) && un > 0) return un;
        const linha = Number(it.total_price) || 0;
        return Number((linha / qtd).toFixed(2));
      })(),
      observacao: it.observation || undefined,
      complementos: opts.join(' · ') || undefined,
    };
  });
  const t = String(raw?.order_type ?? 'delivery').toLowerCase();
  const tipo = t === 'delivery' ? 'entrega' : 'retirada'; // takeout/onsite/closed_table → retirada
  const a = raw?.delivery_address ?? {};
  const endereco =
    [a.street, a.number, a.neighborhood, a.city, a.state].filter(Boolean).join(', ') || undefined;
  const pgtos = raw?.payments ?? [];
  const pgto = pgtos[0] ?? {};
  // A API do CW usa payment_type 'online'|'offline' (e status 'paid'). Os campos
  // prepaid/paid/online que checávamos antes NÃO EXISTEM nesse payload — todo pedido
  // pré-pago do Cardápio Web entrava como "a cobrar na entrega".
  const onlinePg = (p: any) =>
    String(p?.payment_type ?? '').toLowerCase() === 'online' || String(p?.status ?? '').toLowerCase() === 'paid';

  // ===== Dinheiro detalhado (mig 241) — spec oficial api-pedidos.json =====
  // discounts[] é o mais bem classificado de todos os canais:
  //   category    → coupon | loyalty | other  (a ORIGEM)
  //   sponsorship → merchant | ifood          (QUEM BANCA)
  //   total_points → pontos de fidelidade gastos (só em category 'loyalty')
  const descontosCW: DescontoCanal[] = (raw?.discounts ?? [])
    .map((d: any) => {
      const cat = String(d?.category ?? '').toLowerCase();
      const kind = String(d?.kind ?? '').toLowerCase();
      const patroc = String(d?.sponsorship ?? '').toLowerCase();
      const origem: DescontoCanal['origem'] =
        cat === 'loyalty' ? 'fidelidade'
        : cat === 'coupon' ? 'cupom'
        : kind === 'free_delivery' ? 'frete'
        : 'outro'; // 'other' = desconto avulso aplicado no pedido
      const rotulo =
        d?.coupon_name ?? d?.coupon_code ??
        (cat === 'loyalty' ? (d?.item_name ? `Resgate: ${d.item_name}` : 'Fidelidade') : 'Desconto');
      return {
        origem,
        rotulo: String(rotulo),
        valor: Number(d?.total) || 0,
        alvo: kind === 'free_delivery' ? 'DELIVERY_FEE' : kind === 'item' ? 'ITEM' : 'CART',
        // O enum de sponsorship só tem merchant|ifood. Ausente = pedido nativo do CW, cujo
        // cupom/fidelidade é programa DA LOJA — por isso 'loja' em vez de 'indefinido'.
        quemBanca: (patroc === 'ifood' ? 'marketplace' : 'loja') as DescontoCanal['quemBanca'],
        campanha: d?.coupon_code ?? (d?.total_points ? `${d.total_points} pontos` : undefined),
      };
    })
    .filter((d: DescontoCanal) => d.valor > 0);

  // Taxas que o cliente paga e NÃO são produto. Atenção: `payment_fee` SOMA no total (é taxa
  // cobrada do cliente atrelada à forma de pagamento), não é desconto de adquirência.
  const taxaPgto = pgtos.reduce((a: number, p: any) => a + (Number(p?.payment_fee) || 0), 0);
  const taxasCW: TaxaExtraCanal[] = [
    { tipo: 'service_fee', rotulo: 'Taxa de serviço', valor: Number(raw?.service_fee) || 0 },
    { tipo: 'additional_fee', rotulo: 'Taxa adicional', valor: Number(raw?.additional_fee) || 0 },
    { tipo: 'payment_fee', rotulo: 'Taxa da forma de pagamento', valor: taxaPgto },
  ].filter((f) => f.valor > 0);

  const pagamentosCW: PagamentoCanal[] = pgtos.map((p: any) => ({
    codigo: p?.payment_method ? String(p.payment_method) : undefined,
    rotulo: formaPtBr(p?.payment_method),
    valor: Number(p?.total) || 0,
    prepago: onlinePg(p),
    // O schema declara `change_for`, mas um exemplo do próprio spec usa `change_of` —
    // aceita os dois para não perder o troco por causa da inconsistência da doc.
    troco: p?.change_for ?? p?.change_of ?? null,
    bandeira: p?.card_brand ?? undefined,
  }));

  // NÃO existe subtotal nesse payload: o bruto é a soma da linha dos itens (a doc declara
  // total = Σ items.total_price + taxas + payment_fee − Σ discounts.total).
  const brutoCW = (raw?.items ?? []).reduce((a: number, it: any) => a + (Number(it?.total_price) || 0), 0);
  const entregaPorCW = String(raw?.delivered_by ?? '').toLowerCase();

  return {
    externalId: raw?.id != null ? String(raw.id) : undefined,
    displayId: raw?.display_id != null ? String(raw.display_id) : undefined,
    clienteNome: raw?.customer?.name,
    clienteTelefone: raw?.customer?.phone,
    tipo,
    endereco,
    itens,
    total: Number(raw?.total) || 0,
    formaPagamento: formaPtBr(pgto.payment_method ?? (onlinePg(pgto) ? 'online' : 'money')),
    pago: pgtos.length ? pgtos.every(onlinePg) : false,
    valorBruto: brutoCW > 0 ? Number(brutoCW.toFixed(2)) : undefined,
    descontos: descontosCW.length ? descontosCW : undefined,
    pagamentos: pagamentosCW.length ? pagamentosCW : undefined,
    taxaEntregaDono:
      tipo !== 'entrega' ? undefined : entregaPorCW === 'merchant' ? 'loja' : entregaPorCW ? 'marketplace' : undefined,
    valorPagoCliente: Number(raw?.total) || 0,
    taxasExtras: taxasCW.length ? taxasCW : undefined,
  };
}

// 99Food / DiDi Food (openapi.didi-food.com): mapeia o OrderModel da API própria
// do DiDi → modelo interno. Preços vêm em CENTAVOS (int) → dividimos por 100.
// De-para de item por `app_item_id` (o código PDV que subimos no menu do 99food).
// O externalId vem como STRING (order_id 64-bit — nunca convertido a number).
// Tabela oficial de `promo_type` do 99food. Sem ela, toda promoção virava "promoção" genérica
// e o lojista não conseguia saber quanto gastou com cupom vs. clube vs. frete grátis.
// (Quem BANCA não sai daqui — sai de `shop_subside_price`, por promoção.)
const PROMO_99: Record<number, { nome: string; origem: DescontoCanal['origem'] }> = {
  1: { nome: 'Desconto por pedido mínimo', origem: 'promocao' },
  2: { nome: 'Item em promoção', origem: 'promocao' },
  3: { nome: 'Frete grátis por valor', origem: 'frete' },
  4: { nome: 'Leve X pague Y', origem: 'promocao' },
  10: { nome: 'Cupom no pedido', origem: 'cupom' },
  11: { nome: 'Cupom em item', origem: 'cupom' },
  12: { nome: 'Cupom de entrega', origem: 'cupom' },
  20: { nome: 'Desconto de entrega (membro 99food)', origem: 'frete' },
  30: { nome: 'Entrega compartilhada', origem: 'frete' },
  34: { nome: 'Clube 99food', origem: 'fidelidade' },
  100: { nome: 'Cliente novo', origem: 'promocao' },
  101: { nome: 'Cliente recorrente', origem: 'promocao' },
};

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
  const pagoOnline = payType === 1 || payType === 4;
  const p = raw?.price ?? {};
  const cent = (v: any) => (Number(v) || 0) / 100;

  // ===== Dinheiro detalhado (mig 241) =====
  // `shop_subside_price` é o campo que diz QUEM BANCA: é a parte da promoção que a LOJA
  // subsidiou. O resto (promo_discount − shop_subside_price) é o 99food que pagou e que
  // volta no repasse. Sem isso, toda promoção do 99food virava custo da loja.
  const promocoes = raw?.promotions ?? [];
  const descontos: DescontoCanal[] = [];
  for (const pr of promocoes) {
    const total = Number(pr?.promo_discount) || 0;
    const daLoja = Number(pr?.shop_subside_price) || 0;
    const doApp = total - daLoja;
    const t = Number(pr?.promo_type);
    const nome = PROMO_99[t]?.nome ?? (pr?.promo_type != null ? `promo_type ${pr.promo_type}` : 'promoção');
    const origem = PROMO_99[t]?.origem ?? 'promocao';
    const alvo = origem === 'frete' ? 'DELIVERY_FEE' : undefined;
    if (daLoja > 0)
      descontos.push({ origem, rotulo: `Loja · ${nome}`, valor: cent(daLoja), alvo, quemBanca: 'loja', campanha: nome });
    if (doApp > 0)
      descontos.push({ origem, rotulo: `99food · ${nome}`, valor: cent(doApp), alvo, quemBanca: 'marketplace', campanha: nome });
  }
  // ATENÇÃO: `promotions[]` JÁ INCLUI as promoções de entrega (confirmado no exemplo oficial:
  // items_discount 2.488.000 + delivery_discount 400.000 = soma de promotions[]). Somar
  // `delivery_discount` por cima contaria o desconto de frete DUAS VEZES. Ele só entra como
  // fallback quando o pedido vem sem `promotions[]` (modelo de preço 1, que não tem o array).
  const descEntrega = Number(p?.delivery_discount) || 0;
  if (!promocoes.length && descEntrega > 0)
    descontos.push({ origem: 'frete', rotulo: 'Desconto na entrega', valor: cent(descEntrega), alvo: 'DELIVERY_FEE', quemBanca: 'indefinido' });

  // others_fees: gorjeta do entregador, taxa de serviço e taxa de pedido mínimo. Nenhuma é
  // receita de produto — a gorjeta inclusive é do entregador, não da loja.
  const of = p?.others_fees ?? {};
  const taxasExtras: TaxaExtraCanal[] = [
    { tipo: 'total_tip_money', rotulo: 'Gorjeta do entregador', valor: cent(of?.total_tip_money) },
    { tipo: 'service_price', rotulo: 'Taxa de serviço', valor: cent(of?.service_price ?? p?.service_price) },
    { tipo: 'small_order_price', rotulo: 'Taxa de pedido mínimo', valor: cent(of?.small_order_price) },
    { tipo: 'meal_top_up_price', rotulo: 'Complemento de pedido mínimo', valor: cent(of?.meal_top_up_price ?? p?.meal_top_up_price) },
  ].filter((f) => f.valor > 0);

  const pagamentos: PagamentoCanal[] = [
    {
      codigo: payType ? `pay_type_${payType}` : undefined,
      rotulo: formaPtBr(PAY[payType] ?? 'online'),
      valor: totalCents / 100,
      prepago: pagoOnline,
      troco: null, // o 99food não informa troco; o entregador recolhe shop_paid_money
    },
  ];

  // delivery_type: 1 = entrega do 99food · 2 = entrega da loja · 0 = retirada.
  // Com a logística do 99food, o frete cobrado do cliente NÃO é receita da loja.
  const delivType = Number(raw?.delivery_type);
  // fulfillment_mode 1 = retirada no balcão. Antes o tipo era 'entrega' fixo e TODO pedido
  // de retirada da 99 entrava como entrega no Regem.
  const retirada = Number(raw?.fulfillment_mode) === 1 || delivType === 0;

  return {
    externalId: raw?.order_id != null ? String(raw.order_id) : undefined,
    displayId: raw?.order_index != null ? String(raw.order_index) : undefined,
    clienteNome: addr.name ?? addr.first_name,
    clienteTelefone: tel,
    tipo: retirada ? 'retirada' : 'entrega',
    endereco,
    itens,
    total: totalCents / 100,
    formaPagamento: formaPtBr(PAY[payType] ?? 'online'),
    pago: pagoOnline, // online/wallet = pago; dinheiro/pos = na entrega
    // order_price = soma dos itens SEM promoção e SEM entrega: é o bruto do produto.
    valorBruto: p?.order_price != null ? cent(p.order_price) : undefined,
    descontos: descontos.length ? descontos : undefined,
    pagamentos,
    taxaEntregaDono: retirada ? undefined : delivType === 2 ? 'loja' : delivType === 1 ? 'marketplace' : undefined,
    valorPagoCliente: totalCents / 100,
    taxasExtras: taxasExtras.length ? taxasExtras : undefined,
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
