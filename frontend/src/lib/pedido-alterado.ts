// PEDIDO ALTERADO (mig 362; pedido do dono, 03/11/2026 — protótipo `mockups/regem-alteracao-pedido.html`): os textos do
// quadro "O que mudou" da gaveta do pedido. O que mudou vem pronto do servidor (`pedido_alteracao`); a regra da
// alteração está só lá (`backend/src/modules/pedido-alterado/pedido-alterado.ts`).
import { hora } from '@/lib/atendimento';

export type ItemDaMudanca = { acao: 'por' | 'tirar'; descricao: string; quantidade: number; valor: number };
export type Mudanca = {
  itens: ItemDaMudanca[];
  endereco: { de: string | null; para: string; referencia: string | null } | null;
  taxa: { de: number; para: number } | null;
  troco: { de: number | null; para: number | null } | null;
};
export type Valores = {
  total: number;
  taxaEntrega: number;
  trocoPara: number | null;
  cashback: number;
  aReceber?: number | null;
  cozinha?: boolean; // a cozinha recebeu a mudança (algum cartão dela mexeu)
};
export type Alteracao = {
  id: string;
  origem: 'equipe' | 'robo' | string;
  situacao: string;
  porNome: string | null;
  createdAt: string;
  mudanca: Mudanca;
  antes: Valores | null;
  depois: Valores | null;
  vias: { impressora: string; via: string }[] | null;
  pedidoDoCliente: string | null;
  motivo?: string | null; // por que o servidor da loja recusou
  vencida?: boolean; // a "pedida" passou da validade sem resposta da loja (a regra é do servidor)
  // O que foi pedido; `depoisQueSaiu` = o endereço mudado pelo caso urgente de Atendimento com o pedido já na rua (PR 3b-2).
  pedido?: { depoisQueSaiu?: boolean } | null;
};

/** A alteração foi feita depois que o pedido saiu (só o endereço, sem via — a equipe avisa o entregador pelo WhatsApp). */
export const depoisQueSaiu = (a: Pick<Alteracao, 'pedido'>) => a.pedido?.depoisQueSaiu === true;
export type HistoricoDaAlteracao = {
  alteracoes: Alteracao[];
  impressoras: Record<string, string>;
  cozinha: { pendente: boolean; vistoEm: string | null; vistoPor: string | null };
};

export const brl = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** A hora (HH:MM) no fuso da loja. */
export const horaDaAlteracao = (iso: string | null | undefined) => hora(iso);

/** "+ 1 Batata frita média · R$ 14,00" e "− 1 Coca-Cola lata · R$ 7,00", na ordem em que vieram. */
export function linhasDosItens(m: Mudanca | null | undefined): { sinal: '+' | '−'; texto: string; valor: string }[] {
  return (m?.itens ?? []).map((i) => ({
    sinal: i.acao === 'por' ? '+' : '−',
    texto: `${Number(i.quantidade) || 1} ${i.descricao}`,
    valor: brl(i.valor),
  }));
}

/** Uma linha só: "+ 1 Batata" · "troca de 1 Coca por 1 Guaraná" · "tirar 1 Coca" · "endereço novo: …" (o histórico). */
export function resumoDaMudanca(m: Mudanca | null | undefined): string {
  if (!m) return 'alteração';
  const postos = m.itens.filter((i) => i.acao === 'por');
  const tirados = m.itens.filter((i) => i.acao === 'tirar');
  const q = (n: number) => String(Number(n) || 1);
  const partes: string[] = [];
  if (postos.length === 1 && tirados.length === 1) {
    partes.push(`troca de ${q(tirados[0].quantidade)} ${tirados[0].descricao} por ${q(postos[0].quantidade)} ${postos[0].descricao}`);
  } else {
    for (const p of postos) partes.push(`+ ${q(p.quantidade)} ${p.descricao}`);
    for (const t of tirados) partes.push(`tirar ${q(t.quantidade)} ${t.descricao}`);
  }
  if (m.endereco) partes.push(`endereço novo: ${m.endereco.para}`);
  if (m.troco && !m.itens.length && !m.endereco) partes.push(`troco para ${m.troco.para != null ? brl(m.troco.para) : 'sem troco'}`);
  return partes.join(' · ') || 'alteração';
}

/** "pelo cliente no WhatsApp" (robô) ou "por Ana" (equipe). */
export const quemAlterou = (a: Pick<Alteracao, 'origem' | 'porNome'>) =>
  a.origem === 'robo' ? 'pelo cliente no WhatsApp' : `por ${a.porNome || 'alguém da equipe'}`;

/** "R$ 45,00 → R$ 59,00" ou "R$ 45,00 (não mudou)". */
export function antesAgora(de: number | null | undefined, para: number | null | undefined): string {
  if (Number(de ?? 0) === Number(para ?? 0)) return `${brl(para)} (não mudou)`;
  return `${brl(de)} → ${brl(para)}`;
}

/** "Cozinha e Expedição, às 19:51" — o nome das impressoras que receberam a via nova. */
export function textoDasVias(a: Pick<Alteracao, 'vias' | 'createdAt'>, nomes: Record<string, string>): string | null {
  const vias = a.vias ?? [];
  if (!vias.length) return null;
  const rotulos = [...new Set(vias.map((v) => nomes[v.impressora] ?? (v.via === 'cliente' ? 'Caixa' : 'Cozinha')))];
  const lista = rotulos.length > 1 ? `${rotulos.slice(0, -1).join(', ')} e ${rotulos[rotulos.length - 1]}` : rotulos[0];
  return `${lista}, às ${horaDaAlteracao(a.createdAt)}`;
}

/** A alteração mudou algo para a cozinha (itens)? Só endereço e troco não mudam nada para ela. */
export const mudouACozinha = (m: Mudanca | null | undefined) => (m?.itens.length ?? 0) > 0;
