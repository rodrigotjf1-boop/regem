// ENDEREÇO DEPOIS QUE O PEDIDO SAIU (PR 3b-2 do pedido alterado; decisão 8 aprovada pelo dono em 03/11/2026 — protótipo
// `mockups/regem-alteracao-pedido.html`, vista "Painel da loja" › "endereço depois que saiu"). Os textos da gaveta do caso
// urgente que o robô abre: o que o robô anotou mora em `detalhe.endereco` (backend `atendimento/endereco-depois-que-saiu.ts`,
// onde fica a regra); aqui só se lê e se escreve para a tela.

/* eslint-disable @typescript-eslint/no-explicit-any */

export type EnderecoCurto = { rua: string | null; numero: string | null; bairro: string | null; referencia: string | null };
export type Distancia = { km: number; min: number | null; pelo: 'caminho' | 'linha_reta' };
export type EnderecoDoCaso = {
  pedidoId: string;
  numero: string | null;
  de: EnderecoCurto;
  para: EnderecoCurto;
  taxaAntes: number;
  /** null = o endereço novo fica fora da área de entrega. */
  taxaNova: number | null;
  total: number;
  /** O que o entregador recebe hoje (a conta da alteração, no servidor). */
  aReceber?: number;
  /** A conta com a taxa da área nova, feita no servidor (V74) — ou por que não dá. null = fora da área. */
  comANova?: { total: number; aReceber: number } | { recusa: string } | null;
  pagoAntes: boolean;
  formaPagamento: string | null;
  trocoPara: number | null;
  entregador: { nome: string | null; telefone: string | null; saiuEm: string | null } | null;
  /** Ausente = ainda medindo; null = não deu para medir. */
  distancia?: Distancia | null;
  mudado?: { em: string; porNome: string | null; taxa: number; alteracaoId: string } | null;
};
export type EscolhaDaTaxa = 'manter' | 'nova';

const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
export const brl = (n: number | null | undefined) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** O endereço que o robô anotou no caso (null = o caso não tem). */
export function enderecoDoCaso(detalhe: any): EnderecoDoCaso | null {
  const e = detalhe?.endereco;
  if (!e || typeof e !== 'object' || typeof e.pedidoId !== 'string' || !e.para || typeof e.para !== 'object') return null;
  return e as EnderecoDoCaso;
}

/** "Rua das Flores, 120 · Centro". */
export function emUmaLinha(e: Partial<EnderecoCurto> | null | undefined): string {
  if (!e) return '';
  const ruaENumero = [e.rua, e.numero].filter((x) => x && String(x).trim()).join(', ');
  return [ruaENumero, e.bairro].filter((x) => x && String(x).trim()).join(' · ');
}

/** "Rua Ipê, 45" — rua e número. */
export const ruaENumero = (e: Partial<EnderecoCurto> | null | undefined) =>
  [e?.rua, e?.numero].filter((x) => x && String(x).trim()).join(', ') || emUmaLinha(e);

/** "2,4 km pelo caminho (≈ 7 min de moto)" · "2,4 km em linha reta" · "medindo…" · "não deu para medir". */
export function textoDaDistancia(d: Distancia | null | undefined): string {
  if (d === undefined) return 'medindo…';
  if (!d) return 'não deu para medir (confira no mapa)';
  const km = `${d.km.toLocaleString('pt-BR', { maximumFractionDigits: 1, minimumFractionDigits: d.km < 10 ? 1 : 0 })} km`;
  if (d.pelo === 'linha_reta') return `${km} em linha reta`;
  return `${km} pelo caminho${d.min ? ` (≈ ${d.min} min de moto)` : ''}`;
}

/** A conta com a taxa nova, quando dá (a do servidor — a mesma da gravação). */
const contaDaNova = (e: EnderecoDoCaso) => (e.comANova && 'total' in e.comANova ? e.comANova : null);

/**
 * Por que "cobrar a nova" não dá (null = dá): fora da área, pago pelo link, a mesma taxa, ou a recusa da conta do servidor
 * (o troco não cobre o valor novo) — a gaveta nunca oferece o que a gravação recusaria (V74).
 */
export function porQueNaoCobraANova(e: EnderecoDoCaso): string | null {
  if (e.taxaNova == null) return 'o endereço novo fica fora da área de entrega';
  if (e.pagoAntes) return 'o pedido foi pago pelo link';
  if (r2(e.taxaNova) === r2(e.taxaAntes)) return 'a taxa da área nova é a mesma';
  if (e.comANova && 'recusa' in e.comANova) return e.comANova.recusa.replace(/[.:]\s*$/, '');
  if (!contaDaNova(e)) return 'a conta com a taxa nova não veio';
  return null;
}

/** A escolha que vale: "nova" só quando dá (senão a do pedido). */
export const escolhaQueVale = (e: EnderecoDoCaso, escolha: EscolhaDaTaxa): EscolhaDaTaxa =>
  escolha === 'nova' && !porQueNaoCobraANova(e) ? 'nova' : 'manter';

/** A taxa da escolha. */
export const taxaDaEscolha = (e: EnderecoDoCaso, escolha: EscolhaDaTaxa) =>
  escolhaQueVale(e, escolha) === 'nova' ? r2(e.taxaNova ?? e.taxaAntes) : r2(e.taxaAntes);

/** O total do pedido e o que o entregador recebe com a taxa escolhida (as contas do servidor). */
export function valoresDaEscolha(e: EnderecoDoCaso, escolha: EscolhaDaTaxa): { total: number; aReceber: number } {
  const nova = escolhaQueVale(e, escolha) === 'nova' ? contaDaNova(e) : null;
  return nova ?? { total: r2(e.total), aReceber: r2(e.aReceber ?? e.total) };
}

/** "Dinheiro na entrega · troco para R$ 50,00" (ou "pago pelo link"). */
export function textoDoPagamento(e: EnderecoDoCaso): string {
  if (e.pagoAntes) return 'pago pelo link';
  const forma = (e.formaPagamento || 'na entrega').trim();
  return `${forma.charAt(0).toUpperCase()}${forma.slice(1)}${e.trocoPara != null ? ` · troco para ${brl(e.trocoPara)}` : ''}`;
}

/** O número no formato do WhatsApp (55 + DDD + número). */
export function numeroDoWhatsapp(t: string | null | undefined): string {
  const d = String(t ?? '').replace(/\D/g, '');
  return d.length === 10 || d.length === 11 ? `55${d}` : d;
}

/** A mensagem pronta para o entregador: o endereço novo e, no pago na entrega, quanto receber. */
export function mensagemAoEntregador(e: EnderecoDoCaso, escolha: EscolhaDaTaxa): string {
  const nome = e.entregador?.nome ? `, ${e.entregador.nome.split(' ')[0]}` : '';
  const n = e.numero ? `do pedido nº ${e.numero}` : 'do pedido';
  const ref = e.para.referencia ? ` (${e.para.referencia})` : '';
  const { aReceber } = valoresDaEscolha(e, escolha);
  const receber =
    e.pagoAntes || aReceber <= 0
      ? ' O pedido já está pago.'
      : ` Receber ${brl(aReceber)}${e.trocoPara != null ? ` (troco para ${brl(e.trocoPara)})` : ''}.`;
  return `Oi${nome}! O endereço ${n} mudou: agora é ${emUmaLinha(e.para)}${ref}.${receber}`;
}

/** O link do WhatsApp do entregador com a mensagem pronta (null = sem telefone do entregador). */
export function linkDoEntregador(e: EnderecoDoCaso, escolha: EscolhaDaTaxa): string | null {
  const numero = numeroDoWhatsapp(e.entregador?.telefone);
  if (!numero) return null;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagemAoEntregador(e, escolha))}`;
}

/** O rascunho do "Não dá: responder ao cliente" (vai para o campo da conversa — a pessoa ajusta antes de enviar). */
export function rascunhoNaoDa(e: EnderecoDoCaso): string {
  const n = e.numero ? `do pedido nº ${e.numero}` : 'do pedido';
  return `Não conseguimos mudar o endereço ${n}: o entregador já está a caminho da ${ruaENumero(e.de)}. Você consegue receber lá?`;
}

/** "Endereço atualizado! O entregador já está indo para a Rua Ipê, 45 👍" — o que o cliente recebe (o texto do servidor). */
export const textoAoCliente = (e: EnderecoDoCaso) => `Endereço atualizado! O entregador já está indo para a ${ruaENumero(e.para)} 👍`;
