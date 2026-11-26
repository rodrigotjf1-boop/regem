import { FRASES_DA_NOTA, type NotaNoMister, type PedidoDaNota } from '../../common/nota-por-foto';

// P4 DE "PEDIDOS E RECEBIMENTO" — A NOTA OU O CUPOM QUE BATE COM UM PEDIDO ABERTO (protótipo
// `mockups/regem-pedidos-recebimento.html`, aprovado em 25/11/2026; PR-7 e a decisão do dono: "ao receber pedido, perguntar
// se é para lançar no estoque").
//
// A foto lida e ligada aos insumos procura o pedido de compra aberto que bate pelos itens: metade ou mais dos itens do pedido
// estão na nota (PR-7). Achando, o Mister pergunta "Registrar o recebimento?" e, com "Receber o pedido", "Lançar no estoque?"
// (no cupom, no lugar do "Como deseja lançar?"):
//  • "Lançar no estoque": o pedido é recebido pelo MESMO serviço de Estoque › Pedidos, com a quantidade e o valor da nota; o que
//    o pedido tem e a nota não, fica como falta; o que a nota tem a mais entra pelo recebimento avulso de sempre. A nota não dá
//    entrada de novo (era o que travava o "receber com o cupom": a entrada em dobro);
//  • "Só marcar recebido": o pedido fica recebido sem mexer no estoque, e entra só a despesa da nota.
// A despesa é sempre a da nota (o cupom já pago, as parcelas da NF): o recebimento do pedido não cria conta. Aqui só a parte
// sem banco.

/** Um pedido aberto, com os insumos dele, que a busca lê do banco (do mais novo para o mais velho). */
export interface CandidatoDoPedido {
  listaId: string;
  nome: string;
  fornecedorId: string | null;
  fornecedor: string | null;
  /** Quando o pedido foi criado, "DD/MM". */
  criado: string;
  itemIds: string[];
}

/**
 * O pedido que bate com a nota (PR-7): metade ou mais dos itens do pedido estão entre os insumos ligados da nota, e ao menos um.
 * Entre os que batem, o do mesmo fornecedor da nota primeiro, depois o que bate em mais da metade, depois o mais novo.
 */
export function pedidoQueBate(candidatos: CandidatoDoPedido[], insumosDaNota: string[], fornecedorDaNota: string | null): PedidoDaNota | null {
  const naNota = new Set(insumosDaNota.filter(Boolean));
  if (!naNota.size) return null;
  const doFornecedor = (c: CandidatoDoPedido) => (fornecedorDaNota && c.fornecedorId === fornecedorDaNota ? 1 : 0);
  const batem = candidatos
    .map((c) => {
      const ids = [...new Set(c.itemIds.filter(Boolean))];
      return { c, itens: ids.length, batem: ids.filter((i) => naNota.has(i)).length };
    })
    .filter((x) => x.itens > 0 && x.batem >= 1 && x.batem * 2 >= x.itens);
  // A ordenação do JavaScript é estável: no empate, fica a ordem da busca (o mais novo antes).
  batem.sort((a, b) => doFornecedor(b.c) - doFornecedor(a.c) || b.batem / b.itens - a.batem / a.itens);
  const x = batem[0];
  return x ? { listaId: x.c.listaId, nome: x.c.nome, fornecedor: x.c.fornecedor, criado: x.c.criado, itens: x.itens, batem: x.batem, resposta: null } : null;
}

/** O documento recebe o pedido? (Só depois de "Receber o pedido".) */
export const recebePedido = (n: Pick<NotaNoMister, 'pedido'>): boolean => n.pedido?.resposta === 'receber';

/**
 * A nota dá entrada no estoque? A resposta ao "Lançar no estoque?" (do pedido) ou ao "Como deseja lançar?" (do cupom) vale; sem
 * resposta, a nota de fornecedor dá entrada e o cupom não.
 */
export const lancaEstoque = (n: Pick<NotaNoMister, 'comoLancar' | 'especie'>): boolean => (n.comoLancar ? n.comoLancar === 'estoque' : n.especie !== 'cupom');

const doDocumento = (n: Pick<NotaNoMister, 'especie'>) => (n.especie === 'cupom' ? { este: 'este cupom', nele: 'nele', do: 'do cupom', com: 'com este cupom' } : { este: 'esta nota', nele: 'nela', do: 'da nota', com: 'com esta nota' });
const cabecalho = (n: NotaNoMister) => (n.especie === 'cupom' ? FRASES_DA_NOTA.cabecalhoDoCupom(n) : FRASES_DA_NOTA.cabecalho(n));
const itens = (k: number) => (k === 1 ? '1 item' : `${k} itens`);
const reais = (c: number) => (c / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** O que o recebimento do pedido pela nota fez (P4), com as decisões das diferenças (versão 10, C1b). */
export interface ResumoDoPedidoRecebido {
  entraram: number;
  faltaram: string[];
  naoVieram: string[];
  pendentes: string[];
  aMais: number;
  /** C1b: o pedido novo com o que ainda chega. */
  chegaDepois?: { nome: string; itens: string[]; para: string | null };
  /** C1b: o que foi cancelado (não volta a ser pedido). */
  cancelados?: string[];
  /** C1b-2: o que veio de outro lugar, com a conta (paga, ou que não entrou). */
  deOutroLugar?: Array<{ item: string; fornecedor: string; valorCentavos: number; pago: boolean }>;
}

export const FRASES_DO_PEDIDO_DA_NOTA = {
  /** A nota lida que bate com um pedido aberto (o protótipo: "Temos a lista de pedido … que bate com este cupom"). */
  bate: (n: NotaNoMister, p: PedidoDaNota): string => {
    const d = doDocumento(n);
    return (
      `${cabecalho(n)}\n\nTemos o pedido "${p.nome}"${p.fornecedor ? ` (${p.fornecedor})` : ''}, criado em ${p.criado}, com ${itens(p.itens)}, que bate com ${d.este}: ` +
      `${p.batem} dos ${p.itens} itens estão ${d.nele}. Registrar o recebimento?`
    );
  },
  /** A pergunta do dono, depois de "Receber o pedido". */
  estoque: (n: NotaNoMister, p: PedidoDaNota): string => {
    const d = doDocumento(n);
    return (
      `Recebo o pedido "${p.nome}" ${d.com}. Lançar no estoque?\n` +
      `• Lançar no estoque: cada item entra no estoque pelo recebimento do pedido, com a quantidade e o valor ${d.do}; o que não veio fica como falta.\n` +
      '• Só marcar recebido: o pedido fica recebido sem mexer no estoque, e entra só a despesa.'
    );
  },
  /** A linha do resumo antes do "Lançar". */
  noResumo: (n: NotaNoMister, p: PedidoDaNota): string =>
    lancaEstoque(n)
      ? `📦 O pedido "${p.nome}" é recebido com ${doDocumento(n).este}: a entrada no estoque sai pelo pedido.`
      : `📦 O pedido "${p.nome}" fica marcado como recebido, sem mexer no estoque.`,
  /** PR-8: o resumo da nota que dá entrada sem pedido que bata (sem pedido aberto, ou "Não é deste pedido"). */
  semPedidoNoResumo: (n: NotaNoMister): string =>
    `📦 Sem pedido aberto que bata com ${doDocumento(n).este}: a entrada vira um pedido já recebido em Estoque › Pedidos.`,
  /** O resumo da NF com "Só marcar recebido": só a conta a pagar (o cupom tem o dele, já pago). */
  soDespesaDaNota: (n: NotaNoMister): string => {
    const parcelas = n.duplicatas.length > 1 ? ` em ${n.duplicatas.length} parcelas` : '';
    return `${FRASES_DA_NOTA.cabecalho(n)}\n\nLanço a conta a pagar de R$ ${reais(n.valorTotalCentavos)}${parcelas}? O estoque não muda.`;
  },
  /** O que o lançamento fez com o pedido (vai antes da mensagem de sempre do lançamento). */
  recebido: (p: PedidoDaNota, r: ResumoDoPedidoRecebido): string => {
    // C1b: o que já tem destino (cancelado, ou num pedido novo) não aparece de novo como "fica como falta no pedido".
    const decididos = new Set([...(r.cancelados ?? []), ...(r.chegaDepois?.itens ?? [])]);
    const naoVieram = r.naoVieram.filter((n) => !decididos.has(n));
    return (
    `📦 Recebi o pedido "${p.nome}" em Estoque › Pedidos: ${itens(r.entraram)} ${r.entraram === 1 ? 'entrou' : 'entraram'} no estoque` +
    `${r.aMais ? ` (e ${itens(r.aMais)} a mais, pelo recebimento avulso)` : ''}.` +
    `${r.faltaram.length ? ` Veio menos: ${r.faltaram.join('; ')}.` : ''}` +
    `${naoVieram.length ? ` Não ${naoVieram.length === 1 ? 'veio' : 'vieram'} (fica como falta no pedido): ${naoVieram.join(', ')}.` : ''}` +
    // Versão 10, C1b: o que a pessoa decidiu sobre as diferenças.
    `${r.chegaDepois ? ` O que ainda chega (${r.chegaDepois.itens.join(', ')}) está no pedido "${r.chegaDepois.nome}"${r.chegaDepois.para ? `, para ${r.chegaDepois.para.slice(8, 10)}/${r.chegaDepois.para.slice(5, 7)}` : ''}.` : ''}` +
    `${r.cancelados?.length ? ` ${r.cancelados.length === 1 ? 'Cancelado' : 'Cancelados'}: ${r.cancelados.join(', ')} (não ${r.cancelados.length === 1 ? 'volta' : 'voltam'} a ser pedido).` : ''}` +
    // C1b-2: o que veio de outro lugar.
    (r.deOutroLugar ?? [])
      .map((x) => ` ${x.item} veio de ${x.fornecedor}, R$ ${reais(x.valorCentavos)}: ${x.pago ? 'a conta entrou já paga' : 'a conta NÃO entrou, lance em Financeiro › Contas a pagar'}.`)
      .join('') +
    `${r.pendentes.length ? ` A validade de ${r.pendentes.join(', ')} ficou pendente: responda a data quando souber.` : ''}`
    );
  },
  semEstoque: (p: PedidoDaNota): string => `📦 Marquei o pedido "${p.nome}" como recebido em Estoque › Pedidos, sem mexer no estoque.`,
  /** PR-8: a nota sem pedido virou um pedido já recebido. */
  criado: (p: PedidoDaNota, pendentes: string[]): string =>
    `📦 Não havia pedido aberto que batesse: registrei como pedido já recebido em Estoque › Pedidos, "${p.nome}".` +
    `${pendentes.length ? ` A validade de ${pendentes.join(', ')} ficou pendente: responda a data quando souber.` : ''}`,
};

/** Os botões (o WhatsApp aceita até 20 letras em cada um). */
export const botoesDoPedidoDaNota = (documentoId: string) => [
  { id: `doc:pd:${documentoId}:r`, titulo: 'Receber o pedido' },
  { id: `doc:pd:${documentoId}:n`, titulo: 'Não é deste pedido' },
];
export const botoesDoEstoqueDoPedido = (documentoId: string) => [
  { id: `doc:pd:${documentoId}:e`, titulo: 'Lançar no estoque' },
  { id: `doc:pd:${documentoId}:s`, titulo: 'Só marcar recebido' },
];

export function lerBotaoDoPedidoDaNota(botaoId: unknown): { documentoId: string; escolha: 'r' | 'n' | 'e' | 's' } | null {
  const m = /^doc:pd:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}):(r|n|e|s)$/i.exec(String(botaoId ?? ''));
  return m ? { documentoId: m[1].toLowerCase(), escolha: m[2].toLowerCase() as 'r' | 'n' | 'e' | 's' } : null;
}
