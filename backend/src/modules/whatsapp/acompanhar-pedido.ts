/* eslint-disable @typescript-eslint/no-explicit-any */
import { horaNoFuso } from '../../common/data';
import { modoEntrega } from '../entregador/modo-entrega';

// "CADÊ MEU PEDIDO?" COM A PREVISÃO REAL (item 1 do plano das leituras do Mister para o atendente — aprovado pelo dono em
// 26/11/2026). A rota dos pedidos do robô dava só o texto da situação ("saiu para entrega"), e a descrição da ferramenta no
// n8n prometia "a estimativa", que não vinha (a IA era convidada a inventar). Agora cada pedido em andamento leva o
// `acompanhar`: quem entrega, as horas (recebido, aceito, pronto, saiu), a previsão de chegada pela posição AO VIVO do
// entregador (a mesma conta da página de rastreio e do aviso "saiu"), a parada dele ("a sua é a 2ª de 3"), o horário do
// agendado e o link da página de acompanhar. Só o que o cliente vê na página de rastreio — nunca a posição, o telefone do
// entregador nem a fila da cozinha.

export type LinhaParaAcompanhar = {
  status?: unknown;
  tipo?: unknown;
  canal?: unknown;
  raw?: unknown;
  criadoEm?: unknown;
  confirmadoEm?: unknown;
  prontoEm?: unknown;
  despachadoEm?: unknown;
  agendamento?: unknown;
  retiradaTipo?: unknown;
  rastreioToken?: unknown;
  ordemParada?: unknown;
};

export type Acompanhar = {
  /** loja = o entregador da loja; plataforma = o do iFood ou da 99 (acompanha pelo app deles); retirada = o cliente busca. */
  quemEntrega: 'loja' | 'plataforma' | 'retirada';
  recebidoAs: string | null;
  aceitoAs: string | null;
  prontoAs: string | null;
  saiuAs: string | null;
  /** "20h35" — só a entrega da loja que já saiu, com o GPS do entregador ao vivo; sem isso, null (não inventar). */
  chegaPorVoltaDe: string | null;
  /** A entrega do cliente na saída do entregador ("a sua é a 2ª de 3") — só com mais de uma parada. */
  parada: { suaEntrega: number; de: number } | null;
  /** O pedido agendado: "28/11 às 20h00". */
  agendadoPara: string | null;
  /** A página de acompanhar do pedido (`/r/…`), quando a entrega é da loja ou é retirada. */
  linkAcompanhar: string | null;
  /** Na entrega da plataforma: onde o cliente acompanha ("pelo app do iFood"). */
  acompanhaPeloApp: string | null;
};

const ENCERRADOS = new Set(['entregue', 'concluido', 'cancelado']);

function data(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "20h05" no fuso da operação, ou null. */
export function horaDoPedido(v: unknown): string | null {
  const d = data(v);
  return d ? horaNoFuso(d).replace(':', 'h') : null;
}

function diaEHora(v: unknown): string | null {
  const d = data(v);
  if (!d) return null;
  const dia = d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });
  return `${dia} às ${horaNoFuso(d).replace(':', 'h')}`;
}

/**
 * O acompanhamento de um pedido EM ANDAMENTO (encerrado ou cancelado → null: o texto da situação basta). `chegaPorVoltaDe`
 * vem de fora (a previsão pelo GPS mora no Delivery); `totalDeParadas` = os pedidos da mesma saída do entregador.
 */
export function acompanharPedido(
  p: LinhaParaAcompanhar,
  extra: { basePublica: string; chegaPorVoltaDe?: string | null; totalDeParadas?: number | null },
): Acompanhar | null {
  const status = String(p.status ?? '');
  if (!status || ENCERRADOS.has(status)) return null;
  const modo = modoEntrega({ tipo: p.tipo, canal: p.canal, raw: p.raw });
  const quemEntrega: Acompanhar['quemEntrega'] = modo === 'retirada' ? 'retirada' : modo === 'logistica_canal' ? 'plataforma' : 'loja';
  const saiu = status === 'despachado' && quemEntrega !== 'retirada';
  const ordem = Number(p.ordemParada);
  const total = Number(extra.totalDeParadas);
  const token = String(p.rastreioToken ?? '').trim();
  const base = String(extra.basePublica ?? '').replace(/\/+$/, '');
  const canal = String(p.canal ?? '');
  return {
    quemEntrega,
    recebidoAs: horaDoPedido(p.criadoEm),
    aceitoAs: horaDoPedido(p.confirmadoEm),
    prontoAs: horaDoPedido(p.prontoEm),
    saiuAs: saiu ? horaDoPedido(p.despachadoEm) : null,
    chegaPorVoltaDe: saiu && quemEntrega === 'loja' ? (extra.chegaPorVoltaDe ?? null) : null,
    parada:
      saiu && quemEntrega === 'loja' && Number.isInteger(ordem) && ordem >= 1 && Number.isInteger(total) && total > 1 && ordem <= total
        ? { suaEntrega: ordem, de: total }
        : null,
    agendadoPara: String(p.retiradaTipo ?? '') === 'agendado' ? diaEHora(p.agendamento) : null,
    linkAcompanhar: quemEntrega !== 'plataforma' && token && /^https:\/\//i.test(base) ? `${base}/r/${encodeURIComponent(token)}` : null,
    acompanhaPeloApp: quemEntrega === 'plataforma' ? (canal === 'ifood' ? 'pelo app do iFood' : canal === '99food' ? 'pelo app da 99' : 'pelo app da plataforma') : null,
  };
}

/** A base pública do app (a página `/r/…`) — a mesma do Delivery e do rastreio. */
export function basePublicaDoApp(): string {
  return (process.env.CARDAPIO_PUBLIC_URL || process.env.APP_URL || 'https://app.dmsregem.com').replace(/\/$/, '');
}
