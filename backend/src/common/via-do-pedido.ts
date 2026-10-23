// Os dados do PEDIDO DE CANAL (delivery, retirada) como saem impressos — escritos uma vez só, para a via do caixa (a via
// do delivery, que vai com o entregador), a reimpressão, a comanda do entregador e a via de produção saírem iguais.
// Pedido do dono (22–23/10/2026): a via do caixa saía pelo modelo do balcão, sem nome, telefone, endereço, número do
// pedido e troco, com "Venda balcão" e com o total só dos itens (sem a taxa de entrega e sem o desconto). O troco e o
// valor a cobrar vêm de `entregador/cobranca.ts` (a mesma conta do app do entregador).

/** Nome do canal como o cliente e o entregador o conhecem. Canal desconhecido sai como veio. */
export const ROTULO_CANAL: Record<string, string> = {
  cardapio: 'Cardápio',
  manual: 'Telefone',
  n8n: 'WhatsApp',
  ifood: 'iFood',
  '99food': '99Food',
  keeta: 'Keeta',
  anotaai: 'Anota Aí',
  cardapio_web: 'Cardápio Web',
  delivery_direto: 'Delivery Direto',
  rappi: 'Rappi',
  totem: 'Totem',
  gogem: 'Totem',
  balcao: 'Balcão',
};

export function rotuloDoCanal(canal: string | null | undefined): string {
  const c = String(canal ?? '').trim();
  return ROTULO_CANAL[c.toLowerCase()] ?? c;
}

/** "iFood #8F2A" — o canal e o número do pedido nele (o que o entregador procura no app). */
export function pedidoNoCanal(canal: string | null | undefined, displayId: string | null | undefined): string | undefined {
  const rotulo = rotuloDoCanal(canal);
  const num = String(displayId ?? '').trim();
  if (!rotulo && !num) return undefined;
  if (!num) return rotulo;
  return `${rotulo} ${num.startsWith('#') ? num : `#${num}`}`.trim();
}

type EnderecoDoPedido = {
  endereco?: string | null;
  enderecoRua?: string | null;
  enderecoNumero?: string | null;
  enderecoBairro?: string | null;
  enderecoReferencia?: string | null;
  enderecoCidade?: string | null;
};

/**
 * Endereço em linhas: "Rua, nº", "Bairro - Cidade", "Ref: …". Com os campos separados (cardápio, canais que mandam o
 * endereço fiscal), monta deles; sem eles, usa o texto inteiro do pedido. A comanda do entregador juntava o texto inteiro
 * COM os campos separados e, no pedido do cardápio (onde o texto já traz número, bairro e referência), repetia tudo.
 */
export function enderecoDoPedido(p: EnderecoDoPedido): string | undefined {
  const rua = String(p.enderecoRua ?? '').trim();
  if (rua) {
    const linhas: string[] = [];
    const numero = String(p.enderecoNumero ?? '').trim();
    linhas.push(numero ? `${rua}, ${numero}` : rua);
    const bairro = String(p.enderecoBairro ?? '').trim();
    const cidade = String(p.enderecoCidade ?? '').trim();
    const local = [bairro, cidade].filter(Boolean).join(' - ');
    if (local) linhas.push(local);
    const ref = String(p.enderecoReferencia ?? '').trim();
    if (ref) linhas.push(`Ref: ${ref}`);
    return linhas.join('\n');
  }
  const texto = String(p.endereco ?? '').trim();
  return texto || undefined;
}

/** Pedido do totem (o nosso e o do GoGeM): é venda de balcão — a via dele segue o modelo do balcão, não o do delivery. */
export function ehDoTotem(canal: string | null | undefined): boolean {
  const c = String(canal ?? '').trim().toLowerCase();
  return c === 'totem' || c === 'gogem';
}

/** "DELIVERY", "RETIRADA" ou "ENCOMENDA" — a linha que diz, na via, como o pedido sai da loja. */
export function tipoDoPedido(p: { tipo?: string | null; retiradaTipo?: string | null }): string {
  if (p.retiradaTipo === 'encomenda') return 'ENCOMENDA';
  const t = String(p.tipo ?? '').trim().toLowerCase();
  if (t === 'retirada') return 'RETIRADA';
  if (!t || t === 'entrega') return 'DELIVERY';
  return t.toUpperCase();
}

/**
 * O modelo da VIA DE PRODUÇÃO. Pedido de canal — entrega ou retirada — usa o do delivery: o cabeçalho dele (nº do pedido
 * no canal e nome do cliente) é o que liga a embalagem ao pedido. Balcão, mesa e totem usam o do balcão.
 */
export function perfilDeProducao(
  origem: string | null | undefined,
  plataforma: string | null | undefined,
): 'producao_delivery' | 'producao_balcao' {
  if (origem === 'delivery') return 'producao_delivery';
  if (origem === 'totem') return 'producao_balcao';
  const canal = rotuloDoCanal(plataforma);
  return canal && canal !== 'Totem' && canal !== 'Balcão' ? 'producao_delivery' : 'producao_balcao';
}

/** O tipo na via de produção: só no pedido de canal — o que veio do pedido, senão DELIVERY (entrega) ou RETIRADA. */
export function tipoNaProducao(ctx: {
  origem?: string | null;
  plataforma?: string | null;
  tipoPedido?: string | null;
}): string | undefined {
  if (perfilDeProducao(ctx.origem, ctx.plataforma) !== 'producao_delivery') return undefined;
  return ctx.tipoPedido || (ctx.origem === 'delivery' ? 'DELIVERY' : 'RETIRADA');
}
