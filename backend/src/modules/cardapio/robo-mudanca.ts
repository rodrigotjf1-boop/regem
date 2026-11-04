/* eslint-disable @typescript-eslint/no-explicit-any */
import { normalizar, reais } from './robo-consultas';
import { sugestoesDeTroco } from './robo-pedido';
import { STATUS_ALTERAVEL, valoresDepois } from '../pedido-alterado/pedido-alterado';

// O ROBÔ MUDA O PEDIDO JÁ FEITO (PR 3 do pedido repetido/alterado; pedido do dono de 03/11/2026 — protótipo
// `mockups/regem-alteracao-pedido.html`, vista "Robô do WhatsApp"; decisões 3A, 4A, 7 e 8 aprovadas no mesmo dia).
// As regras puras: quando o robô pode mudar, a conta da mudança e os textos e botões que o cliente recebe. Quem aplica é
// o MESMO `DeliveryService.alterar` da equipe (origem "robo"); na loja com servidor ligado a alteração vai como "pedida"
// e o servidor da loja decide — o cliente recebe "Pedi a mudança à loja ⏳" e, depois, a decisão.
//
// O que o robô muda sozinho (3A): UMA mudança por pedido — pôr, tirar ou trocar um item (a troca também muda a
// quantidade, a versão, um adicional ou a observação de um item) —, com o pedido aceito e ainda na loja, e o item que
// sai ainda não pronto na cozinha. Pedido pago pelo link ou com nota fiscal vai para a equipe (4A, 7), como o resto
// ("Mudança no pedido" em Atendimento). As regras de status, de pago e de troco são as do
// `valoresDepois`/`STATUS_ALTERAVEL` da alteração (V74): a conferência que o cliente vê nunca promete o que a gravação
// recusaria.

export type ItemDoPedidoFeito = {
  /** O número do item para o cliente e para o robô (a ordem em que entrou na venda). */
  linha: number;
  comandaItemId: string;
  produtoId: string | null;
  variacaoId: string | null;
  /** As opções escolhidas (`comanda_item_complemento.opcao_id`): a troca da quantidade repete o item com elas. */
  opcaoIds: string[];
  descricao: string;
  quantidade: number;
  precoUnitario: number;
  observacao: string | null;
  /** A cozinha já deixou este item pronto (o cartão dele está pronto ou entregue): não sai nem troca por aqui. */
  pronto: boolean;
};

export type PedidoFeito = {
  id: string;
  /** O número que o cliente recebeu (o do resumo do pedido). */
  numero: string | null;
  status: string;
  tipo: string;
  total: number;
  trocoPara: number | null;
  /** Pago na entrega numa forma que pode ser dinheiro ("pagar na entrega" ou uma forma de dinheiro): o troco conta. */
  trocoPossivel: boolean;
  /** Já pago fora da entrega (link, canal): mudar o valor vai para a equipe (decisão 4A). */
  pagoAntes: boolean;
  /** Tem nota fiscal emitida, enviada ou em contingência: mudar o valor vai para a equipe (decisão 7). */
  comNota: boolean;
  /** O robô já mudou os ITENS deste pedido (uma mudança de item por pedido — 3A). */
  jaMudouPeloRobo: boolean;
  /** O robô já mudou o ENDEREÇO deste pedido (um por pedido, à parte da mudança de item — PR 3b, decisão 8). */
  jaMudouEnderecoPeloRobo: boolean;
  /** Para onde o pedido vai (entrega) e a taxa que ele pagou. */
  endereco: EnderecoDoPedido;
  taxaEntrega: number;
  /** Uma mudança do robô está com o servidor da loja, ainda dentro do prazo. */
  mudancaPendente: boolean;
  /** A loja desligou "O robô faz mudanças simples" (`robo_config.muda_pedido`, mig 363). */
  desligado: boolean;
  /** Há outro pedido em andamento deste número (o pedido igual, por exemplo): qual mudar, a equipe confere com o cliente. */
  outroEmAndamento: boolean;
  /**
   * A loja tem o servidor ligado numa versão que ainda não aplica a alteração pedida pela nuvem (`quemAplicaAlteracao` =
   * 'servidor_antigo' — a MESMA regra da gravação, que recusaria com `LOJA_COM_SERVIDOR`): a mudança fica com a equipe.
   */
  lojaSemVersao: boolean;
  itens: ItemDoPedidoFeito[];
};

export type Entra = {
  produtoId: string;
  variacaoId: string | null;
  complementos: string[];
  quantidade: number;
  observacao: string | null;
  descricao: string;
  /** O preço de UMA unidade: o do cardápio (promoção e atacado — o que o cliente confere) ou o que ele já pagou. */
  precoUnitario: number;
};
export type Sai = { comandaItemId: string; descricao: string; quantidade: number; precoUnitario: number };
/** O endereço de entrega como o cliente vê: rua, número, bairro e o complemento ou ponto de referência. */
export type EnderecoDoPedido = { rua: string | null; numero: string | null; bairro: string | null; referencia: string | null };
/** O endereço novo pronto para gravar: o bairro da lista de entrega (`bairroId`) ou o ponto no mapa (entrega por distância). */
export type EnderecoNovo = EnderecoDoPedido & { bairroId: string | null; lat: number | null; lng: number | null };
export type OperacaoDoRobo =
  | { tipo: 'por'; entra: Entra }
  | { tipo: 'tirar'; sai: Sai }
  | { tipo: 'trocar'; sai: Sai; entra: Entra }
  // A mudança de ENDEREÇO (PR 3b, decisão 8): `para` nulo enquanto o cliente não disse o endereço novo; a taxa nova é a
  // da área nova pela MESMA conta do cardápio (`taxaDeEntrega`) — a que o cliente confere e a que se grava (V74).
  | { tipo: 'endereco'; de: EnderecoDoPedido; para: EnderecoNovo | null; taxaAntes: number; taxaNova: number };

/** A mudança em andamento na conversa (`robo_carrinho.mudanca`, mig 363). */
export type MudancaDoRobo = {
  /** O id da alteração (idempotência: o "Pode alterar" repetido não muda duas vezes). */
  id: string;
  pedidoId: string;
  numero: string | null;
  op: OperacaoDoRobo;
  /** O troco dito nesta mudança (null = sem troco); ausente = fica o do pedido. */
  trocoPara?: number | null;
  /** A pergunta do troco saiu e espera a resposta. */
  aguardaTroco?: boolean;
  /** A conferência saiu ao cliente: o "Pode alterar" só vale depois dela. */
  conferida?: boolean;
  /** "Pode alterar": aplicada na hora, ou pedida ao servidor da loja (a rotina da nuvem avisa a decisão). */
  situacao?: 'aplicada' | 'pedida' | null;
  pedidaEm?: string | null;
  /** O cliente já soube da decisão da loja (a rotina marca antes de mandar). */
  avisada?: boolean;
  /** A via do WhatsApp da conversa (a da loja que atendeu): a rotina responde pela mesma. */
  via?: 'cloud' | 'evolution';
  /** A mudança de endereço aberta (`pedido_endereco`) espera o endereço novo, que vem pelo `definir_entrega`. */
  aguardaEndereco?: boolean;
  /** O endereço novo já dito, esperando só o complemento ou ponto de referência. */
  enderecoParcial?: EnderecoNovo | null;
  /**
   * O pedido JÁ SAIU para a entrega (PR 3b-2, decisão 8): o robô não muda o endereço — pega o novo e abre o caso urgente
   * em Atendimento (a equipe avisa o entregador e confere a distância). Sem a pergunta da referência.
   */
  depoisQueSaiu?: boolean;
  criadaEm: string;
};

export const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const valor = (v: number) => reais(r2(v)) ?? `R$ ${r2(v).toFixed(2).replace('.', ',')}`;
const qtd = (n: number) => String(Number(n) || 1).replace('.', ',');
/** "pedido nº 57" — ou só "pedido", quando não tem número. */
export const noPedido = (numero: string | null | undefined) => (numero ? `pedido nº ${numero}` : 'pedido');

/**
 * A ORDEM DOS ITENS como o cliente viu no resumo do pedido: os itens da venda nascem na MESMA transação (o mesmo
 * `created_at`) e o id é aleatório — numerar por eles dava "item 2" ao X-Bacon que o cliente leu em primeiro. Os que
 * nasceram juntos seguem a lista do pedido (`pedido_externo.itens`: pelo produto, senão pelo nome); os que entraram
 * depois (numa mudança) vêm depois. Determinística: o `ver_pedido` e a ação numeram igual.
 */
export function ordemDoPedido<T extends { id: string; produtoId: string | null; descricao: string; criadoEm: number }>(itens: T[], lista: unknown): T[] {
  const doPedido: any[] = Array.isArray(lista) ? lista : [];
  const usados = new Set<number>();
  const lugar = new Map<string, number>();
  const pelaOrdem = [...itens].sort((a, b) => a.criadoEm - b.criadoEm || a.id.localeCompare(b.id));
  for (const it of pelaOrdem) {
    let i = doPedido.findIndex((x, k) => !usados.has(k) && !!it.produtoId && String(x?.produtoId ?? '') === it.produtoId);
    if (i < 0) i = doPedido.findIndex((x, k) => !usados.has(k) && normalizar(x?.descricao) === normalizar(it.descricao));
    if (i >= 0) {
      usados.add(i);
      lugar.set(it.id, i);
    }
  }
  const sem = Number.MAX_SAFE_INTEGER;
  return pelaOrdem.sort((a, b) => a.criadoEm - b.criadoEm || (lugar.get(a.id) ?? sem) - (lugar.get(b.id) ?? sem) || a.id.localeCompare(b.id));
}

/** "Rua das Flores, 120 · Centro" — o endereço numa linha, como o painel e a via mostram. */
export function enderecoCurto(e: Partial<EnderecoDoPedido> | null | undefined): string {
  if (!e) return '';
  return [[e.rua, e.numero].filter((x) => x && String(x).trim()).join(', '), e.bairro].filter((x) => x && String(x).trim()).join(' · ');
}

/** A diferença no valor dos itens (positivo = sobe), em reais. A mudança de endereço não mexe nos itens (só na taxa). */
export function deltaDaMudanca(op: OperacaoDoRobo): number {
  if (op.tipo === 'endereco') return 0;
  const entra = op.tipo === 'tirar' ? 0 : r2(op.entra.precoUnitario * op.entra.quantidade);
  const sai = op.tipo === 'por' ? 0 : r2(op.sai.precoUnitario * op.sai.quantidade);
  return r2(entra - sai);
}

export type MotivoParaNaoMudar = {
  motivo: string;
  /** O que dizer ao cliente (com as palavras do robô). */
  mensagem: string;
  /** Oferecer a equipe ("Sim, quero ajuda | Não, obrigado") — a mudança que o robô não faz, a equipe faz. */
  chamaEquipe: boolean;
};

/**
 * Por que o robô NÃO muda este pedido agora (null = muda). Com a operação, também o item pronto. `quer`: a mudança de
 * itens ou a de endereço (a da operação, quando vem) — cada uma uma vez por pedido; o endereço só no pedido de entrega.
 */
export function motivoParaNaoMudar(p: PedidoFeito, op?: OperacaoDoRobo | null, quer?: 'itens' | 'endereco'): MotivoParaNaoMudar | null {
  const querQue = quer ?? (op?.tipo === 'endereco' ? 'endereco' : 'itens');
  const n = noPedido(p.numero);
  const nao = (motivo: string, mensagem: string, chamaEquipe = true): MotivoParaNaoMudar => ({ motivo, mensagem, chamaEquipe });
  if (p.desligado) return nao('desligado', `A mudança no ${n} é feita pela equipe da loja.`);
  // O servidor da loja ainda não aplica a mudança pedida pela nuvem: dizer ANTES da conferência — não depois do "Pode
  // alterar" (a conferência nunca promete o que a gravação recusaria — V74).
  if (p.lojaSemVersao) return nao('loja_sem_versao', `A mudança no ${n} é feita pela equipe da loja.`);
  if (p.outroEmAndamento)
    return nao('dois_pedidos', 'Há mais de um pedido em andamento deste número: para não mudar o pedido errado, alguém da equipe confere com você.');
  if (!STATUS_ALTERAVEL.includes(p.status)) {
    if (p.status === 'cancelado') return nao('cancelado', `O ${n} foi cancelado.`, false);
    if (p.status === 'novo') return nao('chegando', `O ${n} está chegando à loja agora: em 1 minuto dá para mudar por aqui.`, false);
    if (p.status === 'despachado') return nao('saiu', `O ${n} já saiu para a entrega: não dá para mudar por aqui.`);
    if (p.status === 'concluido' || p.status === 'entregue') return nao('entregue', `O ${n} já foi entregue.`);
    return nao('situacao', `O ${n} não dá para mudar por aqui agora.`);
  }
  if (p.mudancaPendente) return nao('uma_por_vez', `A mudança do ${n} ainda está com a loja: a confirmação chega aqui em instantes.`, false);
  if (querQue === 'endereco') {
    // Trocar entre retirada e entrega vai para a equipe (decisão 8).
    if (p.tipo !== 'entrega') return nao('retirada', `O ${n} é de retirada na loja: para virar entrega, alguém da equipe ajuda.`);
    if (p.jaMudouEnderecoPeloRobo) return nao('ja_mudou_endereco', `Por aqui dá para mudar o endereço uma vez por pedido, e o do ${n} já foi mudado.`);
  } else if (p.jaMudouPeloRobo) return nao('ja_mudou', `Por aqui dá para fazer uma mudança por pedido, e o ${n} já foi mudado.`);
  // Decisões 4A e 7 (aprovadas em 03/11): o pedido pago pelo link e o pedido com nota fiscal vão para a equipe — qualquer
  // mudança, também a que não mexe no valor (o ajuste da tela diz "com o pedido em produção e pago na entrega").
  if (p.pagoAntes) return nao('pago', `O ${n} já foi pago pelo link: a mudança precisa de alguém da equipe.`);
  if (p.comNota) return nao('nota', `O ${n} já tem nota fiscal: a mudança precisa de alguém da equipe.`);
  if (op) {
    if (op.tipo === 'tirar' || op.tipo === 'trocar') {
      const sai = op.sai;
      const item = p.itens.find((i) => i.comandaItemId === sai.comandaItemId);
      if (item?.pronto)
        return nao('item_pronto', `O ${item.descricao} já ficou pronto na cozinha: não dá para ${op.tipo === 'tirar' ? 'tirar' : 'trocar'} por aqui.`);
    }
  }
  return null;
}

/**
 * O endereço do pedido que JÁ SAIU (PR 3b-2, decisão 8): o robô leva à equipe como caso urgente (null = leva). O que
 * barra: a loja desligou "O robô faz mudanças simples", dois pedidos em andamento (qual mudar, a equipe confere) e o pedido
 * de retirada (virar entrega é com a equipe) — a mesma resposta de sempre, com a oferta da equipe.
 */
export function motivoDoEnderecoDepoisQueSaiu(p: PedidoFeito): MotivoParaNaoMudar | null {
  const n = noPedido(p.numero);
  if (p.status !== 'despachado') return { motivo: 'situacao', mensagem: `O ${n} não saiu para a entrega.`, chamaEquipe: false };
  if (p.desligado) return { motivo: 'desligado', mensagem: `A mudança no ${n} é feita pela equipe da loja.`, chamaEquipe: true };
  if (p.outroEmAndamento)
    return {
      motivo: 'dois_pedidos',
      mensagem: 'Há mais de um pedido em andamento deste número: para não mudar o pedido errado, alguém da equipe confere com você.',
      chamaEquipe: true,
    };
  if (p.tipo !== 'entrega') return { motivo: 'retirada', mensagem: `O ${n} é de retirada na loja: para virar entrega, alguém da equipe ajuda.`, chamaEquipe: true };
  return null;
}

export type ContaDaMudanca =
  | { ok: true; total: number; aReceber: number; troco: number | null }
  | { ok: false; code: 'PAGO_ONLINE' | 'TROCO_INSUFICIENTE' | 'VALOR_NEGATIVO'; message: string };

/**
 * Os valores do pedido depois da mudança pela MESMA conta da gravação (`valoresDepois`, V74): o total, o que o
 * entregador recebe e o troco. `trocoPara` ausente = fica o do pedido; null = sem troco. A taxa só muda na mudança de
 * endereço (a da área nova).
 */
export function contaDaMudanca(ped: any, op: OperacaoDoRobo, trocoPara?: number | null): ContaDaMudanca {
  const taxaNova = op.tipo === 'endereco' ? op.taxaNova : Number(ped?.taxaEntrega ?? 0);
  const v = valoresDepois(ped, { deltaItens: deltaDaMudanca(op), taxaNova, trocoPara });
  if (!v.ok) return { ok: false, code: v.recusa.code, message: v.recusa.message };
  return {
    ok: true,
    total: r2(Number(v.valores.total)),
    aReceber: r2(v.aReceber),
    troco: v.valores.trocoPara != null ? r2(Number(v.valores.trocoPara)) : null,
  };
}

const comObs = (descricao: string, obs: string | null) => (obs ? `${descricao} (${obs})` : descricao);

/** As linhas da mudança: ➕ põe, ➖ tira, 🔄 troca, 📍 endereço (com a entrega de antes → agora, quando muda). */
export function linhasDaMudanca(op: OperacaoDoRobo): string[] {
  if (op.tipo === 'endereco') {
    if (!op.para) return [];
    const ref = op.para.referencia ? ` (${op.para.referencia})` : '';
    const linhas = [`📍 ${enderecoCurto(op.de)} → ${enderecoCurto(op.para)}${ref}`];
    if (r2(op.taxaAntes) !== r2(op.taxaNova)) linhas.push(`Entrega: ${valor(op.taxaAntes)} → ${valor(op.taxaNova)}`);
    return linhas;
  }
  if (op.tipo === 'por') return [`➕ ${qtd(op.entra.quantidade)} ${comObs(op.entra.descricao, op.entra.observacao)} — ${valor(op.entra.precoUnitario * op.entra.quantidade)}`];
  if (op.tipo === 'tirar') return [`➖ ${qtd(op.sai.quantidade)} ${op.sai.descricao} — ${valor(op.sai.precoUnitario * op.sai.quantidade)}`];
  return [`🔄 ${qtd(op.sai.quantidade)} ${op.sai.descricao} → ${qtd(op.entra.quantidade)} ${comObs(op.entra.descricao, op.entra.observacao)}`];
}

/** "Total: R$ 45,00 → R$ 59,00" ou "Total: R$ 45,00 (não muda)". */
export function linhaDoTotal(antes: number, depois: number): string {
  return r2(antes) === r2(depois) ? `Total: ${valor(antes)} (não muda)` : `Total: ${valor(antes)} → ${valor(depois)}`;
}

const cabecalho = (numero: string | null, op: OperacaoDoRobo, antes: number, depois: number) => [
  `Mudança no ${noPedido(numero)}`,
  ...linhasDaMudanca(op),
  linhaDoTotal(antes, depois),
];

/**
 * A pergunta do troco: o troco do pedido não cobre o valor novo (`naoCobre`), ou o cliente tocou em "Mudar o troco".
 * As opções são as da pergunta do troco do pedido (`sugestoesDeTroco` + "Não preciso de troco").
 */
export function textoDaPerguntaDoTroco(
  numero: string | null,
  op: OperacaoDoRobo,
  totalAntes: number,
  totalDepois: number,
  o: { naoCobre: boolean; trocoAntes: number | null },
): string {
  const pergunta = o.naoCobre
    ? `O troco para ${valor(o.trocoAntes ?? 0)} não cobre o valor novo. Vai precisar de troco para quanto?`
    : 'Vai precisar de troco para quanto?';
  return [...cabecalho(numero, op, totalAntes, totalDepois), '', pergunta].join('\n');
}

export const opcoesDoTroco = (aReceber: number) => [...sugestoesDeTroco(aReceber), 'Não preciso de troco'];

/** A conferência da mudança, com os botões. O troco aparece quando há troco ou quando ele muda. */
export function textoDaConferencia(
  numero: string | null,
  op: OperacaoDoRobo,
  totalAntes: number,
  totalDepois: number,
  troco: { antes: number | null; depois: number | null; possivel: boolean },
): string {
  const linhas = cabecalho(numero, op, totalAntes, totalDepois);
  if (troco.possivel) {
    if (troco.depois !== troco.antes) linhas.push(troco.depois != null ? `Troco para ${valor(troco.depois)} (novo)` : 'Sem troco (novo)');
    else if (troco.depois != null) linhas.push(`Troco para ${valor(troco.depois)} (continua)`);
  }
  return [...linhas, '', 'Confere a mudança 👇'].join('\n');
}

export const OPCAO_PODE_ALTERAR = 'Pode alterar';
export const OPCAO_MUDAR_TROCO = 'Mudar o troco';
export const OPCAO_DEIXAR = 'Deixar como estava';
export const opcoesDaConferencia = (trocoPossivel: boolean) =>
  trocoPossivel ? [OPCAO_PODE_ALTERAR, OPCAO_MUDAR_TROCO, OPCAO_DEIXAR] : [OPCAO_PODE_ALTERAR, OPCAO_DEIXAR];

/** As opções para perguntar se o cliente quer a equipe (a regra 9 das instruções: nunca "atendente" nos botões). */
export const OPCOES_DE_AJUDA = ['Sim, quero ajuda', 'Não, obrigado'];

const linhaDoValor = (total: number, troco: number | null) => `Total: ${valor(total)}${troco != null ? ` · troco para ${valor(troco)}` : ''}.`;

/** "A entrega vai para: Rua Ipê, 45 · Jardim América." — na mudança de endereço. */
const fraseDoEndereco = (e: EnderecoDoPedido | null | undefined) => (e ? ` A entrega vai para: ${enderecoCurto(e)}.` : '');

/** Mudou na hora (loja sem servidor ligado: a nuvem aplica). Na mudança de endereço, para onde a entrega vai agora. */
export function textoDoFeito(numero: string | null, total: number, troco: number | null, endereco?: EnderecoDoPedido | null): string {
  return [`✅ Pronto! ${noPedido(numero).replace(/^p/, 'P')} alterado.${fraseDoEndereco(endereco)}`, linhaDoValor(total, troco)].join('\n');
}

/** Pedida ao servidor da loja (a decisão chega em instantes, pela rotina da nuvem). */
export const TEXTO_DA_PEDIDA = 'Pedi a mudança à loja ⏳ Te confirmo aqui em instantes.';

/**
 * A decisão do servidor da loja, para o cliente. O motivo da recusa é da EQUIPE (o texto da regra da tela) — ao cliente
 * vai só "não conseguiu" e a oferta da equipe; "vencida" já abre o chamado (a rotina chama a equipe).
 */
export function textoDaDecisao(
  numero: string | null,
  situacao: 'aplicada' | 'recusada' | 'vencida',
  o: { total?: number | null; troco?: number | null; endereco?: EnderecoDoPedido | null } = {},
): string {
  const n = noPedido(numero);
  if (situacao === 'aplicada')
    return [`✅ A loja confirmou: ${n} alterado.${fraseDoEndereco(o.endereco)}`, ...(o.total != null ? [linhaDoValor(o.total, o.troco ?? null)] : [])].join('\n');
  if (situacao === 'vencida') return `A loja não respondeu à mudança do ${n}. Já chamei alguém da equipe — te respondem aqui em instantes 🙋`;
  return `A loja não conseguiu mudar o ${n} agora. Quer ajuda de alguém da equipe?`;
}

/** A recusa da gravação (o código da alteração) dita ao cliente. Sem código conhecido: a oferta da equipe. */
export function textoDaRecusaDaGravacao(numero: string | null, code: string | null | undefined): MotivoParaNaoMudar {
  const n = noPedido(numero);
  if (code === 'PAGO_ONLINE') return { motivo: 'pago', mensagem: `O ${n} já foi pago pelo link: a mudança precisa de alguém da equipe.`, chamaEquipe: true };
  if (code === 'NOTA_FISCAL') return { motivo: 'nota', mensagem: `O ${n} já tem nota fiscal: a mudança precisa de alguém da equipe.`, chamaEquipe: true };
  return { motivo: 'nao_mudou', mensagem: `Não consegui mudar o ${n} agora.`, chamaEquipe: true };
}

/** As ações do robô para a mudança do pedido feito, pelo `mexer_no_pedido` (a ferramenta do n8n não muda). */
export const ACOES_DA_MUDANCA = {
  por: ['pedido_por', 'por_no_pedido', 'adicionar_no_pedido', 'acrescentar_no_pedido', 'pedido_adicionar'],
  tirar: ['pedido_tirar', 'tirar_do_pedido', 'remover_do_pedido', 'pedido_remover'],
  trocar: ['pedido_trocar', 'trocar_no_pedido', 'pedido_alterar', 'alterar_item_do_pedido', 'mudar_item_do_pedido'],
  troco: ['troco_da_mudanca', 'pedido_troco', 'mudar_o_troco', 'mudar_troco'],
  // A mudança de endereço (PR 3b): abre aqui; o endereço novo vem pelo `definir_entrega` (a ferramenta que tem os campos).
  endereco: ['pedido_endereco', 'mudar_endereco', 'endereco_do_pedido', 'trocar_endereco', 'mudar_o_endereco'],
  confirmar: ['confirmar_mudanca', 'pode_alterar', 'confirmar_alteracao'],
  desistir: ['desistir_da_mudanca', 'deixar_como_estava', 'cancelar_mudanca', 'nao_alterar'],
};

/** A mudança da conversa (a coluna jsonb) — o que não tem a forma certa conta como nenhuma. */
export function lerMudanca(v: unknown): MudancaDoRobo | null {
  const m = v as MudancaDoRobo | null;
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.pedidoId !== 'string' || !m.op || typeof (m.op as any).tipo !== 'string') return null;
  return m;
}

/** Como o robô vê o pedido feito (`ver_pedido`): os itens numerados, o que dá para mudar e como pedir a mudança. */
export function visaoDoPedidoFeito(p: PedidoFeito, situacaoParaOCliente: string, m: MudancaDoRobo | null) {
  const motivo = motivoParaNaoMudar(p);
  const motivoEnd = motivoParaNaoMudar(p, null, 'endereco');
  // O pedido que já saiu: o endereço novo vai para a equipe como urgente (o robô pega o endereço e chama — PR 3b-2).
  const enderecoPelaEquipe = p.status === 'despachado' && !motivoDoEnderecoDepoisQueSaiu(p);
  const emAndamento = m && m.pedidoId === p.id && !m.situacao ? m : null;
  return {
    numero: p.numero,
    situacao: situacaoParaOCliente,
    ...(p.tipo === 'entrega' ? { endereco: enderecoCurto(p.endereco) + (p.endereco.referencia ? ` (${p.endereco.referencia})` : '') } : { retirada: true }),
    itens: p.itens.map((i) => ({
      linha: i.linha,
      item: `${qtd(i.quantidade)}x ${comObs(i.descricao, i.observacao)}`,
      valor: valor(i.precoUnitario * i.quantidade),
      ...(i.pronto ? { prontoNaCozinha: true } : {}),
    })),
    total: valor(p.total),
    podeMudar: !motivo,
    ...(motivo ? { motivo: motivo.motivo, mensagem: motivo.mensagem, chamaEquipe: motivo.chamaEquipe } : {}),
    ...(motivo
      ? {}
      : {
          comoMudar:
            'mexer_no_pedido com acao = pedido_por (produto, quantidade, versão, adicionais, observação), pedido_tirar (linha) ou pedido_trocar (linha e o que muda: produto, quantidade, versão, adicionais ou observação).',
        }),
    // O endereço tem a regra dele (uma vez por pedido, só na entrega): pode dar para mudar o endereço e não os itens.
    podeMudarEndereco: !motivoEnd,
    ...(enderecoPelaEquipe
      ? {
          enderecoPelaEquipe: true,
          comoMudarEndereco:
            'O pedido já saiu: mexer_no_pedido com acao = pedido_endereco e o endereço novo em definir_entrega — o Regem chama a equipe como urgente (ela avisa o entregador). Não prometa a mudança.',
        }
      : motivoEnd
        ? motivoEnd.motivo !== motivo?.motivo
          ? { motivoEndereco: motivoEnd.motivo, mensagemEndereco: motivoEnd.mensagem }
          : {}
        : { comoMudarEndereco: 'mexer_no_pedido com acao = pedido_endereco; depois o endereço novo em definir_entrega (rua, número, bairro e referência).' }),
    ...(emAndamento
      ? {
          mudancaEmConferencia: {
            mudanca:
              emAndamento.op.tipo === 'endereco' && !emAndamento.op.para
                ? [emAndamento.depoisQueSaiu ? '📍 esperando o endereço novo (o pedido já saiu: vai para a equipe)' : '📍 esperando o endereço novo']
                : linhasDaMudanca(emAndamento.op),
            ...(emAndamento.aguardaTroco ? { esperandoOTroco: true } : {}),
            ...(emAndamento.aguardaEndereco ? { esperandoOEndereco: true } : {}),
          },
        }
      : {}),
    dica: 'Só fale deste pedido se o cliente quiser saber dele ou mudar algo nele.',
  };
}
