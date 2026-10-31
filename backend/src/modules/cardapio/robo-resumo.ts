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

export function resumoDoPedido(
  ped: any,
  opts: { formaNome?: string | null; tempoMin?: number | null } = {},
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
  if (troco != null && troco > 0) {
    const volta = paraReais(paraCentavos(troco) - paraCentavos(total));
    l.push(volta > 0 ? `Troco para ${reais(troco)} → *troco de ${reais(volta)}*` : `Troco para ${reais(troco)}`);
  }
  l.push('');
  l.push(sit.aceito ? '👨‍🍳 *Seu pedido foi aceito e já está em produção!*' : '📩 *Recebemos seu pedido!* Assim que a loja aceitar, ele entra em produção.');
  return { texto: l.join('\n'), situacao: sit.texto, aceito: sit.aceito };
}
