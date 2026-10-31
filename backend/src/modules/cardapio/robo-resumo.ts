/* eslint-disable @typescript-eslint/no-explicit-any */
import { paraCentavos, paraReais } from '../../util/dinheiro';
import { reais } from './robo-consultas';

// O RESUMO DO PEDIDO REGISTRADO PELO ROBÔ (Fase 5, F4 — pedido do dono de 30/10/2026): o texto que o cliente recebe no
// WhatsApp quando o pedido entra no Regem. Sai do pedido GRAVADO (`pedido_externo`), nunca do que a IA lembra: número,
// itens com as escolhas e as observações, subtotal, entrega, desconto, TOTAL, forma de pagamento e troco. Uma informação
// por linha, com espaço entre os blocos e o que importa em negrito (o *texto* do WhatsApp), para não cansar a vista.
// Sempre por ESCRITO, também na conversa por áudio (resumo em áudio fica longo e difícil de acompanhar — o dono).

/** "X-Bacon · Grande (Bacon extra, Coca-Cola)" → o nome e as escolhas, cada uma na sua linha. */
export function partesDoItem(descricao: unknown): { nome: string; escolhas: string[] } {
  const d = String(descricao ?? '').trim();
  const m = d.match(/^(.*\S)\s\((.+)\)$/);
  if (!m) return { nome: d, escolhas: [] };
  return { nome: m[1], escolhas: m[2].split(', ').map((s) => s.trim()).filter(Boolean) };
}

const SITUACAO: Record<string, { texto: string; aceito: boolean }> = {
  novo: { texto: 'recebido — a loja vai aceitar em instantes', aceito: false },
  confirmado: { texto: 'aceito e em produção', aceito: true },
  pronto: { texto: 'pronto', aceito: true },
  despachado: { texto: 'saiu para entrega', aceito: true },
  concluido: { texto: 'entregue', aceito: true },
  cancelado: { texto: 'cancelado', aceito: false },
};

/** Os dados do resumo PARA CONFERIR (antes de registrar), tirados do carrinho com as contas do cardápio. */
export type ParaConferir = {
  itens: { quantidade: number; descricao: string; observacao: string | null; totalCent: number | null }[];
  subtotal: number;
  tipo: 'entrega' | 'retirada' | null;
  endereco?: { rua: string; numero: string; bairro: string | null; referencia: string | null } | null;
  taxa: number;
  /** Bloco 1b: os descontos do pedido (cupom, prêmio da fidelidade, cashback), já rateados como o pedido grava. */
  descontos?: { rotulo: string; valor: number }[];
  total: number;
  /** O cashback (em reais) e os pontos que o pedido dá na confirmação (a conta do crédito). */
  cashbackGanho?: number;
  pontosGanhos?: number;
  formaNome: string | null;
  trocoPara: number | null;
  semTroco: boolean;
  observacao: string | null;
};

/** As opções do resumo para conferir (os três botões). */
export const OPCOES_DA_CONFERENCIA = ['Pode registrar', 'Pôr observação', 'Quero mudar algo'];

/** "Troco para R$ 100,00 → troco de R$ 30,00" (ou só "Troco para…" quando a nota não passa do total). */
function linhaDoTroco(trocoPara: number, total: number): string {
  const volta = paraReais(paraCentavos(trocoPara) - paraCentavos(total));
  return volta > 0 ? `Troco para ${reais(trocoPara)} → *troco de ${reais(volta)}*` : `Troco para ${reais(trocoPara)}`;
}

/** "🎁 Com este pedido você ganha R$ 2,50 de cashback" (e/ou os pontos) — nada quando o pedido não dá cashback. */
export function linhaDoGanho(valor?: number | null, pontos?: number | null, registrado = false): string | null {
  const partes = [Number(valor) > 0 ? `*${reais(Number(valor))}* de cashback` : '', Number(pontos) > 0 ? `*${Number(pontos)} pontos*` : ''].filter(Boolean);
  if (!partes.length) return null;
  return registrado
    ? `🎁 Você ganha ${partes.join(' e ')} com este pedido (entra no seu saldo quando a loja aceitar).`
    : `🎁 Com este pedido você ganha ${partes.join(' e ')}.`;
}

/**
 * O RESUMO PARA CONFERIR (F5 — teste do dono, 31/10/2026): antes de registrar, o Regem manda ao cliente o pedido inteiro
 * — itens com as escolhas e as observações, entrega, pagamento, troco, a observação do pedido e o total — com os botões
 * "Pode registrar / Pôr observação / Quero mudar algo". No teste, o robô montava esse resumo sozinho e mandava só
 * "Pedido de 3 itens… Total: R$ 101,00", sem dizer os itens. O mesmo jeito do resumo final, para não cansar a vista.
 */
export function textoParaConferir(c: ParaConferir): string {
  const l: string[] = ['🧾 *Confere o seu pedido:*', ''];
  for (const it of c.itens) {
    const { nome, escolhas } = partesDoItem(it.descricao);
    l.push(`*${it.quantidade}x ${nome}*${it.totalCent != null ? ` — ${reais(paraReais(it.totalCent))}` : ''}`);
    for (const e of escolhas) l.push(`   + ${e}`);
    if (it.observacao) l.push(`   📝 _${String(it.observacao).trim()}_`);
  }
  l.push('');
  l.push(`Subtotal: ${reais(c.subtotal)}`);
  if (c.tipo === 'entrega') l.push(c.taxa > 0 ? `Taxa de entrega: ${reais(c.taxa)}` : 'Entrega: *grátis* 🎉');
  for (const d of c.descontos ?? []) if (d.valor > 0) l.push(`${d.rotulo}: −${reais(d.valor)}`);
  l.push(`💰 *Total: ${reais(c.total)}*`);
  const ganho = linhaDoGanho(c.cashbackGanho, c.pontosGanhos);
  if (ganho) l.push(ganho);
  l.push('');
  if (c.tipo === 'entrega' && c.endereco) {
    l.push('🛵 *Entrega*');
    const rua = [c.endereco.rua, c.endereco.numero].filter(Boolean).join(', ');
    if (rua) l.push(rua);
    if (c.endereco.bairro) l.push(String(c.endereco.bairro));
    if (c.endereco.referencia) l.push(`Ref.: ${c.endereco.referencia}`);
  } else if (c.tipo === 'retirada') l.push('🏪 *Retirada na loja*');
  l.push('');
  l.push('💳 *Pagamento*');
  l.push(c.formaNome || 'a combinar');
  if (c.trocoPara != null && c.trocoPara > 0) l.push(linhaDoTroco(c.trocoPara, c.total));
  else if (c.semTroco) l.push('Sem troco');
  if (c.observacao) {
    l.push('');
    l.push('📝 *Observação do pedido*');
    l.push(String(c.observacao).trim());
  }
  l.push('');
  l.push('Está tudo certo? 👇');
  return l.join('\n');
}

export function resumoDoPedido(
  ped: any,
  opts: { formaNome?: string | null; tempoMin?: number | null; observacao?: string | null; ganho?: { valor: number; pontos: number } | null } = {},
): { texto: string; situacao: string; aceito: boolean } {
  const itens: any[] = Array.isArray(ped?.itens) ? ped.itens : [];
  const sit = SITUACAO[String(ped?.status ?? 'novo')] ?? SITUACAO.novo;
  const numero = ped?.displayId ?? ped?.numero ?? '';
  const l: string[] = [];
  l.push(`✅ *Pedido nº ${numero} registrado!*`);
  if (ped?.clienteNome && !['Cliente', 'Cardápio'].includes(ped.clienteNome)) l.push(`Obrigado, ${String(ped.clienteNome).split(' ')[0]}!`);
  l.push('');
  l.push('🧾 *Itens*');
  let somaCent = 0;
  for (const it of itens) {
    const qtd = Number(it?.quantidade) || 1;
    const linhaCent = paraCentavos(Number(it?.precoUnitario) || 0) * qtd;
    somaCent += linhaCent;
    const { nome, escolhas } = partesDoItem(it?.descricao);
    l.push(`*${qtd}x ${nome}* — ${reais(paraReais(linhaCent))}`);
    for (const e of escolhas) l.push(`   + ${e}`);
    if (it?.observacao) l.push(`   📝 _${String(it.observacao).trim()}_`);
  }
  l.push('');
  const subtotal = ped?.valorBruto != null ? Number(ped.valorBruto) : paraReais(somaCent);
  const taxa = Number(ped?.taxaEntrega) || 0;
  const desconto = Number(ped?.desconto) || 0;
  const total = Number(ped?.total) || 0;
  l.push(`Subtotal: ${reais(subtotal)}`);
  if (ped?.tipo === 'entrega') l.push(taxa > 0 ? `Taxa de entrega: ${reais(taxa)}` : 'Entrega: *grátis* 🎉');
  if (desconto > 0) l.push(`Desconto: −${reais(desconto)}`);
  l.push(`💰 *Total: ${reais(total)}*`);
  const ganho = linhaDoGanho(opts.ganho?.valor, opts.ganho?.pontos, true);
  if (ganho) l.push(ganho);
  l.push('');
  if (ped?.tipo === 'entrega') {
    l.push('🛵 *Entrega*');
    const rua = [ped?.enderecoRua, ped?.enderecoNumero].filter(Boolean).join(', ');
    if (rua) l.push(rua);
    if (ped?.enderecoBairro && !String(ped.enderecoBairro).startsWith('~')) l.push(String(ped.enderecoBairro));
    if (!rua && ped?.endereco) l.push(String(ped.endereco));
    if (ped?.enderecoReferencia) l.push(`Ref.: ${ped.enderecoReferencia}`);
  } else {
    l.push('🏪 *Retirada na loja*');
  }
  if (opts.tempoMin != null && Number(opts.tempoMin) > 0)
    l.push(`⏱️ ${ped?.tipo === 'entrega' ? 'Previsão de entrega' : 'Fica pronto em'}: até ${Number(opts.tempoMin)} min`);
  l.push('');
  l.push('💳 *Pagamento*');
  l.push(opts.formaNome || String(ped?.formaPagamento ?? 'a combinar'));
  const troco = ped?.trocoPara != null ? Number(ped.trocoPara) : null;
  if (troco != null && troco > 0) l.push(linhaDoTroco(troco, total));
  // A observação geral do pedido (F5): a gravada, quando o pedido tiver o campo; senão a do carrinho.
  const obs = String(ped?.observacao ?? opts.observacao ?? '').trim();
  if (obs) {
    l.push('');
    l.push('📝 *Observação do pedido*');
    l.push(obs);
  }
  l.push('');
  l.push(sit.aceito ? '👨‍🍳 *Seu pedido foi aceito e já está em produção!*' : '📩 *Recebemos seu pedido!* Assim que a loja aceitar, ele entra em produção.');
  return { texto: l.join('\n'), situacao: sit.texto, aceito: sit.aceito };
}
