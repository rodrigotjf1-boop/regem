import { BadRequestException } from '@nestjs/common';
import { textoNaVia } from '../../common/texto-na-via';

/* eslint-disable @typescript-eslint/no-explicit-any */

// O PEDIDO ALTERADO (pedido do dono, 03/11/2026; protótipo `mockups/regem-alteracao-pedido.html`, aprovado no mesmo dia —
// decisões 3A, 4A, 5A, 6A, 7 e 8; mig 362). As regras puras da alteração do pedido de canal — quem chama é
// `DeliveryService.alterar` (a equipe, pelo painel) e, no PR 3, o robô do WhatsApp, pelo mesmo caminho.
//
// O que a alteração de antes deixava de fazer (medido em 03/11): a lista de itens que o painel, o app do entregador, a
// página do pedido e o robô leem (`pedido_externo.itens`) continuava a antiga; o valor a cobrar e o troco do entregador
// também; a cozinha recebia o item novo num cartão separado e o tirado sumia sem aviso; a via saía sem destaque, numa
// impressora só; e ninguém sabia quem tinha alterado. Em 60 dias, `alterado` = 0: a alteração nunca foi usada.

/** Os canais em que quem manda no pedido é a plataforma: o Regem não altera (o pedido e o pagamento são dela). */
export const CANAIS_SEM_ALTERACAO = ['ifood', '99food', 'keeta', 'rappi'];

/** O pedido de canal aceito e ainda na loja: dá para mudar os itens e o endereço. Depois que sai, vai para a equipe. */
export const STATUS_ALTERAVEL = ['confirmado', 'pronto'];

export const podeAlterarNoCanal = (canal: unknown) => !CANAIS_SEM_ALTERACAO.includes(String(canal ?? '').toLowerCase());

// ===== A alteração pedida na NUVEM para a loja que tem servidor ligado (V53) =====
// A tela da nuvem (e o robô, que roda na nuvem) não mexe na cozinha nem nas impressoras da loja: grava a alteração como
// "pedida" e manda um comando ao servidor da loja; QUEM DECIDE (aplicada | recusada) é só o servidor da loja, pelo mesmo
// `alterar` da equipe. A nuvem nunca decide — assim os dois lados nunca discordam (o sincronismo só garante que a decisão
// não volta a "pedida": `naoVoltaAPedida`/`decisaoVence` no sync.service e `condicaoSobrescrever` no sync-daemon).

/** A versão do servidor da loja que aplica a alteração vinda da nuvem. Mais antigo: a tela da nuvem recusa com o motivo. */
export const VERSAO_QUE_APLICA_ALTERACAO = '1.30.13';

/** A "pedida" tem validade: o servidor da loja que a recebe depois disso recusa ("chegou tarde") — a mesma regra que a
 *  tela usa para mostrar "a loja não respondeu" (V80: a regra é UMA). */
export const VALIDADE_DA_PEDIDA_MIN = 5;

export const pedidaVencida = (criadaEm: Date | string | null | undefined, agora = Date.now()) =>
  criadaEm != null && agora - new Date(criadaEm).getTime() > VALIDADE_DA_PEDIDA_MIN * 60_000;

/** O som do KDS no pedido alterado (decisão 6A): toca ao chegar e repete até o "Visto" — o padrão é a cada 1 minuto. */
export const SONS_DO_ALTERADO = ['uma', '1min', '2min'] as const;
export type SomDoAlterado = (typeof SONS_DO_ALTERADO)[number];
export const SOM_DO_ALTERADO_PADRAO: SomDoAlterado = '1min';

/** O grupo "Pedido alterado" dos ajustes do atendimento: `{ som }`, conferido antes de gravar qualquer grupo. */
export function lerAjusteAlterado(dto: unknown): { som: SomDoAlterado } {
  const som = (dto as any)?.som;
  if (!(SONS_DO_ALTERADO as readonly string[]).includes(som))
    throw new BadRequestException('Som do pedido alterado: escolha "uma vez", "a cada 1 minuto" ou "a cada 2 minutos".');
  return { som };
}

export interface ItemDaMudanca {
  acao: 'por' | 'tirar';
  descricao: string;
  quantidade: number;
  valor: number; // o valor da linha (unitário × quantidade)
}

export interface Mudanca {
  itens: ItemDaMudanca[];
  endereco: { de: string | null; para: string; referencia: string | null } | null;
  taxa: { de: number; para: number } | null;
  troco: { de: number | null; para: number | null } | null;
}

export const mudancaVazia = (): Mudanca => ({ itens: [], endereco: null, taxa: null, troco: null });

/** A cozinha recebe aviso (via, KDS, som) só quando os ITENS mudam — endereço e troco não mudam nada para ela. */
export const mudaACozinha = (m: Mudanca) => m.itens.length > 0;

const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;

/** A descrição do item para casar a linha da venda com a do pedido (sem acento, sem caixa, sem espaço sobrando). */
export function chaveDoItem(descricao: unknown): string {
  return String(descricao ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A lista de itens do pedido (o `pedido_externo.itens` que o painel, o app do entregador, a página do pedido e o robô
 * leem) depois da mudança. Cada linha TIRADA da venda leva a primeira linha do pedido com a mesma descrição e a mesma
 * quantidade (o aceite cria uma linha da venda por linha do pedido, com a mesma descrição); as POSTAS entram no fim, no
 * formato do cardápio do Regem. `naoAchados` = linhas tiradas sem par na lista (a lista do canal veio diferente da venda):
 * quem chama registra no log, e a lista fica sem aquela retirada — nunca tira a linha errada.
 */
export function itensDoPedidoDepois(
  itens: unknown,
  tirados: { descricao: string; quantidade: number; precoUnitario?: number | null }[],
  postos: any[],
): { itens: any[]; naoAchados: number } {
  const lista: any[] = Array.isArray(itens) ? [...itens] : [];
  let naoAchados = 0;
  for (const t of tirados) {
    const chave = chaveDoItem(t.descricao);
    const qtd = Number(t.quantidade) || 1;
    let ix = lista.findIndex(
      (it) => chaveDoItem(it?.descricao ?? it?.nome) === chave && (Number(it?.quantidade) || 1) === qtd,
    );
    // Sem a mesma quantidade, a mesma descrição (o canal pode ter mandado 2× numa linha que a venda guardou assim).
    if (ix < 0) ix = lista.findIndex((it) => chaveDoItem(it?.descricao ?? it?.nome) === chave);
    if (ix < 0) {
      naoAchados++;
      continue;
    }
    lista.splice(ix, 1);
  }
  return { itens: [...lista, ...postos], naoAchados };
}

export interface ValoresDoPedido {
  total: string;
  valorBruto: string | null;
  valorPagoCliente: string | null;
  pagamentos: any[] | null;
  trocoPara: string | null;
  taxaEntrega: string;
}

export type RecusaDosValores = { code: 'PAGO_ONLINE' | 'TROCO_INSUFICIENTE' | 'VALOR_NEGATIVO'; message: string };

const brl = (n: number) => `R$ ${r2(n).toFixed(2).replace('.', ',')}`;

/** O pedido já foi pago fora da entrega (link, canal, totem): a diferença não tem como ser cobrada nem devolvida aqui. */
export function pagoAntes(ped: any): boolean {
  const pgtos: any[] = Array.isArray(ped?.pagamentos) ? ped.pagamentos : [];
  if (ped?.pago || ped?.pagoOnline) return true;
  if (String(ped?.statusPagamento ?? '') === 'aprovado') return true;
  return pgtos.length > 0 && pgtos.every((p) => p?.prepago);
}

/**
 * Os valores do pedido depois da mudança, pela DIFERENÇA — nunca pela soma dos itens: no pedido do Anota AI o adicional
 * vem sem preço, e a soma dos itens fica abaixo do total; refazer o total pela soma baixaria o valor sem ninguém mexer.
 * A diferença vai para a forma paga NA ENTREGA (a primeira); o troco é conferido contra o que o entregador vai receber.
 * Pedido pago antes (link, canal, totem) que mudaria de valor é RECUSADO (decisão 4A): cobrar ou devolver a diferença
 * online ainda não existe.
 */
export function valoresDepois(
  ped: any,
  o: { deltaItens: number; taxaNova: number; trocoPara?: number | null },
): { ok: true; valores: ValoresDoPedido; aReceber: number } | { ok: false; recusa: RecusaDosValores } {
  const taxaAntes = r2(Number(ped?.taxaEntrega ?? 0));
  const taxaNova = r2(o.taxaNova);
  const delta = r2(o.deltaItens + (taxaNova - taxaAntes));
  if (delta !== 0 && pagoAntes(ped)) {
    return {
      ok: false,
      recusa: {
        code: 'PAGO_ONLINE',
        message:
          'Pedido já pago fora da entrega: cobrar ou devolver a diferença ainda não dá por aqui. ' +
          'Para pôr um item, faça um pedido novo; para tirar, cancele e refaça o pedido.',
      },
    };
  }
  const total = r2(Number(ped?.total ?? 0) + delta);
  if (total < 0) return { ok: false, recusa: { code: 'VALOR_NEGATIVO', message: 'O pedido ficaria com valor negativo.' } };

  // A forma paga na entrega recebe a diferença; a pré-paga fica como está.
  let pagamentos: any[] | null = Array.isArray(ped?.pagamentos) && ped.pagamentos.length ? ped.pagamentos.map((p: any) => ({ ...p })) : null;
  const trocoPara =
    o.trocoPara !== undefined ? (o.trocoPara == null || !(Number(o.trocoPara) > 0) ? null : r2(Number(o.trocoPara))) : ped?.trocoPara != null ? r2(Number(ped.trocoPara)) : null;
  let aReceber: number;
  if (pagamentos) {
    const ix = pagamentos.findIndex((p) => !p?.prepago);
    if (ix >= 0) {
      const novo = r2((Number(pagamentos[ix].valor) || 0) + delta);
      if (novo < 0) return { ok: false, recusa: { code: 'VALOR_NEGATIVO', message: 'A forma paga na entrega ficaria com valor negativo.' } };
      pagamentos[ix].valor = novo;
      // O troco mora também na forma em dinheiro (o Anota AI manda assim): segue o troco do pedido.
      if (o.trocoPara !== undefined || pagamentos[ix].troco != null) pagamentos[ix].troco = trocoPara;
    }
    aReceber = r2(pagamentos.filter((p) => !p?.prepago).reduce((a, p) => a + (Number(p?.valor) || 0), 0));
  } else {
    aReceber = ped?.pago ? 0 : r2(Number(ped?.valorPagoCliente ?? ped?.total ?? 0) + delta);
  }
  if (trocoPara != null && aReceber > 0 && trocoPara < aReceber) {
    return {
      ok: false,
      recusa: {
        code: 'TROCO_INSUFICIENTE',
        message: `O troco para ${brl(trocoPara)} não cobre o novo valor (${brl(aReceber)}): pergunte ao cliente com quanto vai pagar.`,
      },
    };
  }
  return {
    ok: true,
    aReceber,
    valores: {
      total: total.toFixed(2),
      valorBruto: ped?.valorBruto != null ? r2(Number(ped.valorBruto) + o.deltaItens).toFixed(2) : null,
      valorPagoCliente: ped?.valorPagoCliente != null ? r2(Number(ped.valorPagoCliente) + delta).toFixed(2) : null,
      pagamentos,
      trocoPara: trocoPara != null ? trocoPara.toFixed(2) : null,
      taxaEntrega: taxaNova.toFixed(2),
    },
  };
}

/** O endereço do pedido numa linha ("Rua Ipê, 45 · Jardim América"), como o painel e a via mostram. */
export function enderecoEmLinha(e: { rua?: string | null; numero?: string | null; bairro?: string | null; endereco?: string | null }): string {
  const ruaNum = [e.rua, e.numero].map((v) => String(v ?? '').trim()).filter(Boolean).join(', ');
  const partes = [ruaNum, String(e.bairro ?? '').trim()].filter(Boolean);
  return partes.length ? partes.join(' · ') : String(e.endereco ?? '').trim();
}

const qtd = (n: number) => String(Number(n) || 1);

/** "+ 1 Batata frita média", "troca de 1 Coca-Cola lata por 1 Guaraná", "tirar 1 Coca-Cola lata", "endereço novo: …". */
export function resumoDaMudanca(m: Mudanca): string {
  const postos = m.itens.filter((i) => i.acao === 'por');
  const tirados = m.itens.filter((i) => i.acao === 'tirar');
  const partes: string[] = [];
  if (postos.length === 1 && tirados.length === 1) {
    partes.push(`troca de ${qtd(tirados[0].quantidade)} ${tirados[0].descricao} por ${qtd(postos[0].quantidade)} ${postos[0].descricao}`);
  } else {
    for (const p of postos) partes.push(`+ ${qtd(p.quantidade)} ${p.descricao}`);
    for (const t of tirados) partes.push(`tirar ${qtd(t.quantidade)} ${t.descricao}`);
  }
  if (m.endereco) partes.push(`endereço novo: ${m.endereco.para}`);
  if (m.troco && !m.itens.length && !m.endereco) partes.push(`troco para ${m.troco.para != null ? brl(m.troco.para) : 'sem troco'}`);
  return partes.join(' · ');
}

const valorNaVia = (n: number) => r2(n).toFixed(2).replace('.', ',');
const SEPARADOR = '@C ========================';

/**
 * O DESTAQUE no alto da via da COZINHA (decisão 5A): "PEDIDO" e "ALTERADO" no tamanho máximo da impressora (4×), um em
 * cada linha — cabem nos dois papéis (8 letras em 58 mm) —, "Descarte TODAS as vias anteriores" e o que mudou. A
 * impressora não imprime branco no preto: o destaque é o tamanho, o negrito e as linhas duplas. Sem "·" e "→" (fora do
 * ASCII, somem na impressora sem página de código).
 */
export function linhasDoAlteradoNaCozinha(m: Mudanca, hora: string): string {
  const l = ['@CBD4 PEDIDO', '@CBD4 ALTERADO', '@CB Descarte TODAS as vias anteriores', SEPARADOR, `@CB O QUE MUDOU - ${hora}`];
  for (const i of m.itens) {
    l.push(`@B ${i.acao === 'por' ? '+ NOVO ' : '- TIRAR'} ${qtd(i.quantidade)} ${textoNaVia(i.descricao)}`);
  }
  l.push(SEPARADOR);
  return l.join('\n') + '\n';
}

/** O mesmo destaque na via do CAIXA e do ENTREGADOR, com os valores, o endereço novo e a taxa. */
export function linhasDoAlteradoNoEntregador(m: Mudanca, hora: string): string {
  const l = ['@CBD4 PEDIDO', '@CBD4 ALTERADO', '@CB Descarte TODAS as vias anteriores', SEPARADOR, `@CB O QUE MUDOU - ${hora}`];
  for (const i of m.itens) {
    const sinal = i.acao === 'por' ? '+' : '-';
    // A barra separa as duas colunas da linha: na descrição ela vira "/".
    const desc = textoNaVia(i.descricao).replace(/\|/g, '/');
    l.push(`@LR${sinal} ${qtd(i.quantidade)} ${desc}|${i.acao === 'por' ? '' : '-'}${valorNaVia(i.valor)}`);
  }
  if (m.endereco) {
    l.push('@B ENDERECO NOVO:');
    l.push(`@B ${textoNaVia(m.endereco.para)}`);
    if (m.endereco.referencia) l.push(`Ref.: ${textoNaVia(m.endereco.referencia)}`);
    if (m.endereco.de) l.push(`(era ${textoNaVia(m.endereco.de)})`);
  }
  if (m.taxa && m.taxa.de !== m.taxa.para) l.push(`@B Entrega: de ${valorNaVia(m.taxa.de)} para ${valorNaVia(m.taxa.para)}`);
  if (m.troco && m.troco.de !== m.troco.para) {
    l.push(`@B Troco para: ${m.troco.para != null ? valorNaVia(m.troco.para) : 'sem troco'}${m.troco.de != null ? ` (era ${valorNaVia(m.troco.de)})` : ''}`);
  }
  l.push(SEPARADOR);
  return l.join('\n') + '\n';
}
