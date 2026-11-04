/* eslint-disable @typescript-eslint/no-explicit-any */
import { uuidDeChave } from '../../common/id-deterministico';
import { pedidaVencida } from '../pedido-alterado/pedido-alterado';

// ENDEREÇO DEPOIS QUE O PEDIDO SAIU (PR 3b-2 do pedido alterado; decisão 8 aprovada pelo dono em 03/11/2026: "o cliente
// consegue até alterar endereço se o pedido ainda em produção, após é necessário atendimento para alertar entregador e
// avaliar a distância dos endereços" — protótipo `mockups/regem-alteracao-pedido.html`, vista "Painel da loja" ›
// "endereço depois que saiu").
//
// O robô NÃO muda: pega o endereço novo e abre o caso URGENTE em Atendimento com o endereço do pedido, o novo, a
// distância entre os dois, a taxa da área nova, o pagamento e o entregador (`atendimento_chamado.detalhe.endereco`).
// Quem muda é a equipe, pelo caso ("Mudar o endereço e avisar o entregador"): o MESMO `DeliveryService.alterar`, com
// `depoisQueSaiu` (só o endereço, sem cozinha e sem via) e a taxa escolhida entre as duas que o Regem calculou. O
// cliente recebe "Endereço atualizado!" quando a mudança vale — na loja com servidor, depois que o servidor dela aplica
// (a rotina da nuvem confere a decisão pelo sincronismo, como a do robô).

export type EnderecoCurto = { rua: string | null; numero: string | null; bairro: string | null; referencia: string | null };
export type EnderecoNovoDoCaso = EnderecoCurto & { bairroId: string | null; lat: number | null; lng: number | null };

/** A distância entre o endereço do pedido e o novo: pelo caminho (OSRM) ou, sem ele, em linha reta. */
export type Distancia = { km: number; min: number | null; pelo: 'caminho' | 'linha_reta' };

/**
 * O que a equipe fez pelo caso ("Mudar o endereço e avisar o entregador") — gravado UMA vez, pela ação. O que acontece
 * depois (a loja aplicou ou recusou, o cliente recebeu o aviso) mora na própria alteração (`pedido_alteracao`), que
 * sincroniza com a decisão do servidor da loja: a fila lê de lá (`estadoDaMudancaDoEndereco`) — um escritor por lugar.
 */
export type MudancaDoEndereco = {
  em: string;
  porId: string | null;
  porNome: string | null;
  /** A taxa gravada no pedido: a de antes ("Manter") ou a da área nova ("Cobrar a nova"). */
  taxa: number;
  alteracaoId: string;
};

/** O aviso ao cliente gravado na alteração (`pedido.avisoAoCliente`) pela rotina da nuvem. */
export type AvisoAoCliente = { em: string; falhou?: string; expirou?: boolean; semTelefone?: boolean };

/** Em que pé está a mudança do caso, pela alteração do pedido: a regra da validade é a do servidor (V80). */
export type EstadoDaMudancaDoEndereco = {
  situacao: 'aplicada' | 'pedida' | 'recusada' | 'vencida';
  motivo: string | null;
  aviso: AvisoAoCliente | null;
};

export type EnderecoDoCaso = {
  pedidoId: string;
  numero: string | null;
  de: EnderecoCurto;
  para: EnderecoNovoDoCaso;
  taxaAntes: number;
  /** A taxa da área nova pela conta do cardápio; null = o endereço novo fica fora da área de entrega. */
  taxaNova: number | null;
  total: number;
  /** O que o entregador recebe hoje (a taxa do pedido) — a conta da alteração (`contaDaMudanca`), não o total. */
  aReceber: number;
  /**
   * A conta com a taxa da área nova, pela MESMA função da gravação (V74): o total e o que o entregador recebe — ou por
   * que não dá (o troco não cobre, pago pelo link). null = não há taxa nova (fora da área).
   */
  comANova: { total: number; aReceber: number } | { recusa: string } | null;
  pagoAntes: boolean;
  formaPagamento: string | null;
  trocoPara: number | null;
  entregador: { nome: string | null; telefone: string | null; saiuEm: string | null } | null;
  /** A via do WhatsApp da conversa: a rotina responde ao cliente pela mesma. */
  via: 'cloud' | 'evolution' | null;
  /** Medida depois de abrir o caso (não segura o robô); null = não deu para medir. Ausente = ainda medindo. */
  distancia?: Distancia | null;
  mudado?: MudancaDoEndereco | null;
  em: string;
};

/** Até quantos minutos depois do "Mudar" a rotina ainda manda "Endereço atualizado!" (depois disso, já não ajuda). */
export const AVISO_DO_ENDERECO_VALE_MIN = 30;

const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const texto = (v: unknown) => (v == null ? null : String(v).trim() || null);
const numero = (v: unknown) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** "Rua das Flores, 120 · Centro" — o endereço numa linha, como o painel e a via mostram. */
export function enderecoEmUmaLinha(e: Partial<EnderecoCurto> | null | undefined): string {
  if (!e) return '';
  const ruaENumero = [e.rua, e.numero].filter((x) => x && String(x).trim()).join(', ');
  return [ruaENumero, e.bairro].filter((x) => x && String(x).trim()).join(' · ');
}

/** "Rua Ipê, 45" — só a rua e o número (a frase ao cliente e ao entregador). */
export const ruaENumero = (e: Partial<EnderecoCurto> | null | undefined) =>
  [e?.rua, e?.numero].filter((x) => x && String(x).trim()).join(', ') || enderecoEmUmaLinha(e);

/**
 * O id da alteração do caso: o mesmo "Mudar" tocado duas vezes (ou em dois computadores) muda uma vez só. Pelo caso e pelo
 * endereço que o robô anotou (`em`): o cliente que pede OUTRO endereço no mesmo caso gera outra alteração. A nova
 * tentativa depois de uma recusa sai da anterior (`anterior`), também sem sorteio.
 */
export const idDaMudancaDoCaso = (chamadoId: string, em: string, anterior?: string | null) =>
  anterior ? uuidDeChave('endereco-depois-que-saiu', chamadoId, anterior) : uuidDeChave('endereco-depois-que-saiu', chamadoId, em);

/** O estado da mudança pela linha da alteração que a fila juntou (null = a alteração ainda não chegou a este banco). */
export function estadoDaMudancaDoEndereco(x: { situacao?: unknown; motivo?: unknown; criadaEm?: unknown; aviso?: unknown }): EstadoDaMudancaDoEndereco | null {
  const s = String(x.situacao ?? '');
  if (s !== 'aplicada' && s !== 'pedida' && s !== 'recusada') return null;
  const criada = x.criadaEm instanceof Date || typeof x.criadaEm === 'string' ? (x.criadaEm as Date | string) : null;
  const aviso = x.aviso && typeof x.aviso === 'object' ? (x.aviso as AvisoAoCliente) : null;
  return {
    situacao: s === 'pedida' && criada && pedidaVencida(criada) ? 'vencida' : s,
    motivo: texto(x.motivo),
    aviso,
  };
}

/** O que o cliente recebe ao pedir a mudança de endereço do pedido que já saiu (o texto do protótipo). */
export function textoAoClienteDepoisQueSaiu(numeroDoPedido: string | null): string {
  const n = numeroDoPedido ? `Seu pedido nº ${numeroDoPedido}` : 'Seu pedido';
  return `${n} já saiu para entrega, então a mudança de endereço passa pela equipe: ela avisa o entregador e confere a distância. Já chamei — alguém te responde aqui em instantes 🙋`;
}

/** O que o cliente recebe quando a mudança vale (o texto do protótipo). */
export const textoDoEnderecoAtualizado = (para: Partial<EnderecoCurto>) =>
  `Endereço atualizado! O entregador já está indo para a ${ruaENumero(para)} 👍`;

/** O endereço do caso como o robô gravou — o que não tem a forma certa conta como nenhum. */
export function lerEnderecoDoCaso(detalhe: any): EnderecoDoCaso | null {
  const e = detalhe?.endereco;
  if (!e || typeof e !== 'object' || typeof e.pedidoId !== 'string' || !e.para || typeof e.para !== 'object') return null;
  const curto = (x: any): EnderecoCurto => ({ rua: texto(x?.rua), numero: texto(x?.numero), bairro: texto(x?.bairro), referencia: texto(x?.referencia) });
  return {
    pedidoId: e.pedidoId,
    numero: texto(e.numero),
    de: curto(e.de),
    para: { ...curto(e.para), bairroId: texto(e.para.bairroId), lat: numero(e.para.lat), lng: numero(e.para.lng) },
    taxaAntes: r2(Number(e.taxaAntes) || 0),
    taxaNova: numero(e.taxaNova) == null ? null : r2(Number(e.taxaNova)),
    total: r2(Number(e.total) || 0),
    aReceber: r2(Number(e.aReceber ?? e.total) || 0),
    comANova:
      e.comANova && typeof e.comANova === 'object'
        ? typeof e.comANova.recusa === 'string'
          ? { recusa: e.comANova.recusa }
          : { total: r2(Number(e.comANova.total) || 0), aReceber: r2(Number(e.comANova.aReceber) || 0) }
        : null,
    pagoAntes: e.pagoAntes === true,
    formaPagamento: texto(e.formaPagamento),
    trocoPara: numero(e.trocoPara) != null && Number(e.trocoPara) > 0 ? r2(Number(e.trocoPara)) : null,
    entregador: e.entregador && typeof e.entregador === 'object'
      ? { nome: texto(e.entregador.nome), telefone: texto(e.entregador.telefone), saiuEm: texto(e.entregador.saiuEm) }
      : null,
    via: e.via === 'cloud' || e.via === 'evolution' ? e.via : null,
    ...('distancia' in e ? { distancia: lerDistancia(e.distancia) } : {}),
    mudado: e.mudado && typeof e.mudado === 'object' && typeof e.mudado.alteracaoId === 'string' ? (e.mudado as MudancaDoEndereco) : null,
    em: String(e.em ?? ''),
  };
}

function lerDistancia(d: any): Distancia | null {
  if (!d || typeof d !== 'object' || !(Number(d.km) >= 0)) return null;
  return { km: Math.round(Number(d.km) * 10) / 10, min: numero(d.min) == null ? null : Math.max(1, Math.round(Number(d.min))), pelo: d.pelo === 'caminho' ? 'caminho' : 'linha_reta' };
}

/**
 * A taxa que a equipe escolheu: "manter" a do pedido ou "nova" (a da área nova). A nova só existe com o endereço dentro da
 * área e o pedido pago na entrega (o pago pelo link não muda de valor — decisão 4A). Recusa = o texto para a tela.
 */
export function taxaEscolhida(e: EnderecoDoCaso, escolha: unknown): { ok: true; taxa: number } | { ok: false; mensagem: string } {
  if (escolha !== 'manter' && escolha !== 'nova') return { ok: false, mensagem: 'Escolha a taxa da entrega: manter a do pedido ou cobrar a nova.' };
  if (escolha === 'manter') return { ok: true, taxa: e.taxaAntes };
  if (e.taxaNova == null) return { ok: false, mensagem: 'O endereço novo fica fora da área de entrega: não há taxa nova para cobrar. Mantenha a do pedido.' };
  if (e.pagoAntes) return { ok: false, mensagem: 'O pedido foi pago pelo link: o valor não muda por aqui. Mantenha a taxa do pedido.' };
  if (e.comANova && 'recusa' in e.comANova) return { ok: false, mensagem: `${e.comANova.recusa} Mantenha a taxa do pedido.` };
  return { ok: true, taxa: e.taxaNova };
}

/** As três linhas do resumo do robô (o que a fila mostra no lugar do texto corrido). */
export function resumoDoCasoDoEndereco(e: Pick<EnderecoDoCaso, 'numero' | 'de' | 'para'>) {
  const n = e.numero ? `pedido nº ${e.numero}` : 'pedido';
  const ref = e.para.referencia ? ` (${e.para.referencia})` : '';
  return {
    motivo: `o ${n} já saiu para a entrega e o cliente quer mudar o endereço`,
    quer: `entregar em ${enderecoEmUmaLinha(e.para)}${ref} — o pedido vai para ${enderecoEmUmaLinha(e.de) || 'o endereço de antes'}`,
    jaFez: 'chamei a equipe como urgente e avisei o cliente que a equipe avisa o entregador e confere a distância',
  };
}
