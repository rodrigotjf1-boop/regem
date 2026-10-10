// O pedido de compra em TEXTO, pronto para o fornecedor, e os links que abrem o WhatsApp e o e-mail
// de quem está usando com esse texto (decisão do dono, 10/10/2026: o sistema não envia sozinho — a
// pessoa confere e toca em enviar; o fornecedor responde para o número da própria loja).
//
// Regras puras, sem banco: o serviço junta os dados e chama aqui.

export type ItemDoPedido = {
  nome: string | null;
  nomeComercial?: string | null;
  quantidade: unknown;
  unidadeMedida?: string | null;
  marca?: string | null;
  marcaAlternativa?: string | null;
};

export type PedidoParaTexto = {
  loja: string;
  pedido: string;
  fornecedor?: string | null;
  /** Nome da pessoa de contato no fornecedor (cadastro). */
  contato?: string | null;
  /** Data desejada de entrega, `AAAA-MM-DD`. */
  entrega?: string | null;
  itens: ItemDoPedido[];
};

const limpo = (t: unknown): string => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '');
const numero = (v: unknown): string => (Number(v) || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const dataBr = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

/**
 * O número no formato que o `wa.me` pede: só dígitos, com o código do país. Telefone do Brasil
 * escrito com DDD (10 ou 11 dígitos) ganha o 55; com "+" na frente vale como está. `null` quando
 * não dá para montar um número completo (o botão do WhatsApp não aparece).
 */
export function telefoneParaWhatsapp(telefone: unknown): string | null {
  const bruto = typeof telefone === 'string' ? telefone.trim() : '';
  const digitos = bruto.replace(/\D/g, '').replace(/^0+/, '');
  if (bruto.startsWith('+')) return digitos.length >= 8 && digitos.length <= 15 ? digitos : null;
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55')) return digitos;
  return null;
}

/** O assunto do e-mail (e o título do pedido): "Pedido de compra — Loja — Nome do pedido". */
export function assuntoDoPedido(p: Pick<PedidoParaTexto, 'loja' | 'pedido'>): string {
  return ['Pedido de compra', limpo(p.loja), limpo(p.pedido)].filter(Boolean).join(' — ');
}

/**
 * O texto do pedido. Cada produto sai pelo NOME COMERCIAL (como é comprado), com a marca e a 2ª
 * opção; SEM valores — o preço é o fornecedor quem diz. `negrito`: o título entre asteriscos, que o
 * WhatsApp mostra em negrito (no e-mail, sem eles).
 */
export function textoDoPedido(p: PedidoParaTexto, negrito = true): string {
  const titulo = ['Pedido de compra', limpo(p.loja)].filter(Boolean).join(' — ');
  const fornecedor = limpo(p.fornecedor);
  const contato = limpo(p.contato);
  const cabecalho = [
    negrito ? `*${titulo}*` : titulo,
    `Pedido: ${limpo(p.pedido)}`,
    fornecedor ? `Fornecedor: ${fornecedor}${contato ? ` (a/c ${contato})` : ''}` : '',
    p.entrega ? `Entrega desejada: ${dataBr(p.entrega)}` : '',
  ].filter(Boolean);
  const itens = p.itens.map((i) => {
    const marca = limpo(i.marca);
    const segunda = limpo(i.marcaAlternativa);
    const quanto = [numero(i.quantidade), limpo(i.unidadeMedida)].filter(Boolean).join(' ');
    return `• ${quanto} — ${limpo(i.nomeComercial) || limpo(i.nome)}${marca ? ` · marca ${marca}` : ''}${segunda ? ` (2ª opção: ${segunda})` : ''}`;
  });
  return [...cabecalho, '', ...itens, '', 'Por favor, confirme o recebimento deste pedido.'].join('\n');
}

/** Link que abre o WhatsApp de quem clica, na conversa com o número, com o texto já escrito. */
export function linkDoWhatsapp(numeroCompleto: string, texto: string): string {
  return `https://wa.me/${numeroCompleto}?text=${encodeURIComponent(texto)}`;
}

/**
 * O e-mail do cadastro, se tem cara de endereço (um só, sem espaço nem separador) — `null` se não.
 * O que passa aqui vai cru para o `mailto:`, então nada de vírgula, ponto e vírgula ou "<…>".
 */
export function emailParaEnvio(email: unknown): string | null {
  const e = typeof email === 'string' ? email.trim() : '';
  return /^[^\s@<>,;:"'?&#%]+@[^\s@<>,;:"'?&#%]+\.[^\s@<>,;:"'?&#%]+$/.test(e) ? e : null;
}

/** Link que abre o programa de e-mail de quem clica, com destinatário, assunto e corpo. */
export function linkDoEmail(email: string, assunto: string, texto: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(texto.replace(/\r?\n/g, '\r\n'))}`;
}
