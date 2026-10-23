// A VIA DO DELIVERY: a via geral do pedido de canal (delivery, retirada, telefone, marketplaces), que sai no caixa e vai
// com o entregador — perfil "Cliente — delivery" (`entregador` em cupom-perfis.ts). Uma montagem só para a 1ª via (no
// servidor da loja), a reimpressão e a comanda do entregador.
//
// Pedido do dono (22/10/2026): a via do caixa do pedido de canal saía pelo modelo do BALCÃO — sem nome, telefone,
// endereço, número do pedido e troco, com "Venda balcão" e com o total só dos itens (sem a taxa de entrega e sem o
// desconto). O valor a cobrar e o troco vêm de `entregador/cobranca.ts`: a mesma conta que o app do entregador mostra.

import { dataHoraNoFuso } from '../../common/data';
import type { Escolha } from '../../common/adicionais';
import { enderecoDoPedido, pedidoNoCanal, tipoDoPedido } from '../../common/via-do-pedido';
import { calcularCobranca } from '../entregador/cobranca';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Um item como a via o imprime (da venda, ou do próprio pedido quando ainda não há venda). */
export interface ItemDaVia {
  quantidade: number;
  descricao: string;
  precoUnitario: number;
  complementosTexto?: string | null;
  observacao?: string | null;
  escolhas?: Escolha[];
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** A data do pedido (no fuso da loja); sem ela, ou inválida, a hora de agora. */
function quando(v: unknown): string {
  const d = v instanceof Date ? v : v ? new Date(String(v)) : null;
  return dataHoraNoFuso(d && !Number.isNaN(d.getTime()) ? d : new Date());
}

/** Os dados do perfil "Cliente — delivery" (`renderCupomPerfil`) a partir do pedido de canal e dos itens da venda. */
export function dadosDaViaDoDelivery(
  ped: any, // linha de pedido_externo
  itens: ItemDaVia[],
  extra: {
    senha?: number | null;
    senhaPrefixo?: string | null;
    nomeLoja?: string;
    qrData?: string | null;
    forma?: string | null; // a forma já traduzida da venda ("Dinheiro", "PIX"); sem ela, a do canal
    mostrarValoresItem?: boolean;
  } = {},
): Record<string, unknown> {
  const p = ped ?? {};
  const cobranca = calcularCobranca(p);
  const subtotal = r2(itens.reduce((s, it) => s + (Number(it.precoUnitario) || 0) * (Number(it.quantidade) || 0), 0));
  const taxa = Number(p.taxaEntrega) || 0;
  const desconto = Number(p.desconto) || 0;
  return {
    nomeLoja: extra.nomeLoja,
    senha: extra.senha ?? null,
    senhaPrefixo: extra.senhaPrefixo ?? null,
    tipoPedido: tipoDoPedido(p),
    plataforma: pedidoNoCanal(p.canal, p.displayId),
    pedidoRegem: p.numero != null ? `#${p.numero}` : undefined,
    dataHora: quando(p.criadoEm),
    cliente: p.clienteNome || undefined,
    telefone: p.clienteTelefone || undefined,
    endereco: p.tipo === 'retirada' ? undefined : enderecoDoPedido(p),
    itens,
    mostrarValoresItem: extra.mostrarValoresItem !== false,
    subtotal,
    taxaEntrega: taxa > 0 ? taxa : undefined,
    desconto: desconto > 0 ? desconto : undefined,
    // O que o cliente paga — a mesma base da cobrança do entregador; sem ela, a conta da própria via.
    totalGeral: Number(p.valorPagoCliente ?? p.total) || r2(subtotal + taxa - desconto),
    cobrarCliente: cobranca.aReceber,
    pagamento: extra.forma || p.formaPagamento || undefined,
    // Troco só quando há o que levar (dinheiro na entrega, nota maior que o valor a receber).
    troco: cobranca.troco != null ? cobranca.trocoPara : undefined,
    trocoLevar: cobranca.troco ?? undefined,
    bandeiras: p.bandeira || undefined,
    qrData: extra.qrData || undefined,
    fiscal: false,
  };
}
