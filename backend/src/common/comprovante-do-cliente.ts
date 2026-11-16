import { chaveTelefone } from './telefone-chave';

// O COMPROVANTE QUE O CLIENTE MANDA NO WHATSAPP (16/11/2026 — pedido do dono, sobre o documento "Atendente virtual": "o
// comprovante só é preciso saber que é um comprovante, para analisar se o cliente só quer confirmar a compra e mandar uma
// mensagem positiva; analisar e ver se o pedido chegou e está pago. Se não estiver, verificar as possibilidades, ver se ele
// colocou o número de telefone correto — o pedido é vinculado ao número de telefone").
//
// O Regem NÃO lê a imagem (nada do cliente vai a um provedor de IA): decide que é um comprovante pelo CONTEXTO — a foto ou
// o documento chega com o Pix de um pedido deste telefone esperando, com o pedido pago agora há pouco e ainda na loja, ou
// com a legenda/o nome do arquivo/a mensagem de antes falando de pagamento. O que vale é o PEDIDO no sistema, nunca o
// conteúdo do comprovante. As regras são puras (o serviço — `cardapio/comprovante-do-cliente.service.ts` — lê o banco,
// consulta o provedor do Pix, responde e chama a equipe).

/** O pedido do cliente, com o que as regras usam. */
export type PedidoDoComprovante = {
  id: string;
  /** O número que o cliente conhece. */
  numero: string;
  /** novo | confirmado | pronto | despachado | concluido | cancelado */
  status: string;
  /** Como o banco grava (a coluna nunca é nula): na_entrega | aguardando | aprovado | orcamento */
  statusPagamento: string;
  pago: boolean;
  /** O sinal da encomenda já foi pago (`sinal_status = 'pago'`). */
  sinalPago: boolean;
  /** Tem pagamento online (Pix/cartão pelo provedor: aguardando ou aprovado) — senão, paga na entrega. */
  online: boolean;
  tipo: string | null;
  clienteNome: string | null;
  criadoEm: Date;
};

/** Só foto e documento (PDF) podem ser comprovante. Áudio, vídeo e figurinha nunca. */
export const TIPOS_DE_COMPROVANTE = ['image', 'document'];
/** O pedido pago que ainda está na loja conta por este tempo (o cliente manda o print logo depois de pagar). */
export const JANELA_DO_PAGO_MS = 3 * 60 * 60 * 1000;
/** Os pedidos que o serviço olha: os das últimas 12 horas deste telefone. */
export const JANELA_DOS_PEDIDOS_MS = 12 * 60 * 60 * 1000;

const normalizar = (v: unknown) =>
  String(v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const PAGAMENTO = /\b(comprovante|comprovantes|recibo|paguei|pagamento|pix|transferi|transferencia|ja pago|ta pago|esta pago|foi pago|pago ja)\b/;
/** Outro assunto na mesma mensagem (um pedido, uma mudança, uma reclamação): ela ainda tem de chegar ao atendente. */
const OUTRO_ASSUNTO = /\b(quero|queria|acrescent\w*|adicion\w*|coloca\w*|troca\w*|tira\w*|muda\w*|cancel\w*|endereco|cade|demor\w*|atras\w*|errad\w*|falt\w*|veio|cardapio|quanto)\b/;

/** A legenda, o nome do arquivo ou a mensagem de antes falam de pagamento? */
export function falaDePagamento(...textos: unknown[]): boolean {
  return PAGAMENTO.test(normalizar(textos.join(' ')));
}

/** O texto é SÓ sobre o pagamento ("paguei, segue o comprovante")? Então a resposta do comprovante já o respondeu. */
export function soFalaDePagamento(texto: unknown): boolean {
  const t = normalizar(texto);
  if (!t) return true;
  return t.split(' ').length <= 14 && PAGAMENTO.test(t) && !OUTRO_ASSUNTO.test(t);
}

export type DecisaoDoComprovante =
  | { caso: 'nao_e' }
  /** O pedido está pago: a mensagem positiva. */
  | { caso: 'pago'; pedido: PedidoDoComprovante }
  /** O Pix do pedido ainda não confirmou aqui: o serviço consulta o provedor na hora. */
  | { caso: 'aguardando'; pedido: PedidoDoComprovante }
  /** O pedido é para pagar na entrega e o cliente mandou um comprovante: a equipe confere (senão o entregador cobra de novo). */
  | { caso: 'na_entrega'; pedido: PedidoDoComprovante }
  /** O pedido foi cancelado (pago = o estorno é automático; sem pagamento confirmado = a equipe confere). */
  | { caso: 'cancelado'; pedido: PedidoDoComprovante }
  /** Não há pedido com este telefone: pode ter sido digitado outro número na hora de pedir. */
  | { caso: 'sem_pedido' };

/**
 * A mídia é um comprovante? E qual a situação do pedido? `pedidos` = os deste telefone nas últimas horas (qualquer ordem).
 * Sem fala de pagamento, só conta o que é quase certo: o Pix esperando, ou o pedido pago agora há pouco e ainda na loja —
 * a foto que chega depois que o pedido saiu pode ser outra coisa (o lanche errado) e segue para o atendente.
 */
export function decidirComprovante(e: {
  tipo: unknown;
  legenda?: unknown;
  antes?: unknown[];
  arquivoNome?: unknown;
  pedidos: PedidoDoComprovante[];
  agora?: Date;
}): DecisaoDoComprovante {
  if (!TIPOS_DE_COMPROVANTE.includes(String(e.tipo ?? ''))) return { caso: 'nao_e' };
  const agora = (e.agora ?? new Date()).getTime();
  const pedidos = [...e.pedidos].sort((a, b) => b.criadoEm.getTime() - a.criadoEm.getTime());
  const fala = falaDePagamento(e.legenda, e.arquivoNome, ...(e.antes ?? []));
  const quitado = (p: PedidoDoComprovante) => p.pago || p.sinalPago;

  const aguardando = pedidos.find((p) => p.status !== 'cancelado' && p.statusPagamento === 'aguardando' && !quitado(p));
  if (aguardando) return { caso: 'aguardando', pedido: aguardando };
  const pagoNaLoja = pedidos.find(
    (p) => p.online && quitado(p) && ['novo', 'confirmado', 'pronto'].includes(p.status) && agora - p.criadoEm.getTime() <= JANELA_DO_PAGO_MS,
  );
  if (pagoNaLoja) return { caso: 'pago', pedido: pagoNaLoja };
  if (!fala) return { caso: 'nao_e' };

  const pago = pedidos.find((p) => p.status !== 'cancelado' && quitado(p));
  if (pago) return { caso: 'pago', pedido: pago };
  // O mais novo entre o cancelado e o que está para pagar na entrega (quem refez o pedido depois do Pix vencido fala do novo).
  for (const p of pedidos) {
    if (p.status === 'cancelado') return { caso: 'cancelado', pedido: p };
    if (p.statusPagamento === 'na_entrega') return { caso: 'na_entrega', pedido: p };
  }
  // Só um ORÇAMENTO (a encomenda que a loja ainda vai confirmar): não é caso de comprovante — segue para o atendente.
  if (pedidos.some((p) => p.status !== 'cancelado' && p.statusPagamento === 'orcamento')) return { caso: 'nao_e' };
  return { caso: 'sem_pedido' };
}

/**
 * O telefone do pedido é quase o da conversa? (um dígito trocado, dois vizinhos invertidos, um dígito a mais ou a menos) —
 * o sinal de "digitou o número errado na hora de pedir". Os dois pela CHAVE (`chaveTelefone`). Iguais = não é "quase".
 */
export function telefoneParecido(a: unknown, b: unknown): boolean {
  const x = chaveTelefone(a);
  const y = chaveTelefone(b);
  if (!x || !y || x === y) return false;
  // Pela chave (um dígito trocado, dois invertidos) e pelos dígitos como foram escritos (o número com um dígito a menos
  // vira outro pela chave, que completa o 9 do celular).
  return quaseIguais(x, y) || quaseIguais(digitosLocais(a), digitosLocais(b));
}

/** Os dígitos sem o 55 do país e sem o zero da operadora — sem completar o 9 (isso é da chave). */
function digitosLocais(v: unknown): string {
  let d = String(v ?? '').replace(/\D/g, '');
  if (d.startsWith('0055')) d = d.slice(4);
  else if (d.startsWith('55') && d.length >= 12) d = d.slice(2);
  else if (d.startsWith('0')) d = d.slice(1);
  return d;
}

function quaseIguais(x: string, y: string): boolean {
  if (x.length < 10 || y.length < 10 || x === y) return false;
  if (x.length === y.length) {
    const dif: number[] = [];
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) dif.push(i);
    if (dif.length === 1) return true;
    return dif.length === 2 && dif[1] === dif[0] + 1 && x[dif[0]] === y[dif[1]] && x[dif[1]] === y[dif[0]];
  }
  const [maior, menor] = x.length > y.length ? [x, y] : [y, x];
  if (maior.length - menor.length !== 1) return false;
  for (let i = 0; i < maior.length; i++) if (maior.slice(0, i) + maior.slice(i + 1) === menor) return true;
  return false;
}

const primeiroNome = (v: unknown) => {
  const n = String(v ?? '').trim().split(/\s+/)[0] ?? '';
  return /^[\p{L}'-]{2,20}$/u.test(n) ? n.charAt(0).toUpperCase() + n.slice(1).toLowerCase() : '';
};

/** Onde o pedido está, numa frase que continua "Seu pedido nº X …". */
export function situacaoDoPedido(p: Pick<PedidoDoComprovante, 'status' | 'tipo'>): string {
  const entrega = p.tipo === 'entrega';
  if (p.status === 'novo') return 'já foi recebido e entra em preparo já já';
  if (p.status === 'confirmado') return 'já está em produção 👨‍🍳';
  if (p.status === 'pronto') return entrega ? 'está pronto e logo sai para entrega' : 'está pronto para retirada 🎉';
  if (p.status === 'despachado') return entrega ? 'saiu para entrega 🛵' : 'está aguardando a retirada no balcão';
  if (p.status === 'concluido') return entrega ? 'já foi entregue' : 'já foi concluído';
  return 'está em andamento';
}

/** O que a abertura do caso devolveu (`AtendimentoService.abrirPeloRobo`), para a frase final. */
export type EquipeChamada = { foraDoHorario?: boolean; paraOCliente?: string | null; posicao?: number | null; comAlguem?: boolean } | null;

/** A frase da equipe: fora do horário, o texto que a loja definiu (quando a equipe volta); senão "já chamei". */
export function fraseDaEquipe(c: EquipeChamada): string {
  if (!c) return 'Me avisa por aqui se precisar que a equipe confere.';
  if (c.foraDoHorario && String(c.paraOCliente ?? '').trim()) return String(c.paraOCliente).trim();
  if (c.comAlguem) return 'A pessoa que já está com o seu caso confere e te responde por aqui.';
  return `Já chamei a equipe para conferir e te respondem por aqui.${c.posicao && c.posicao > 0 ? ` Você é o ${c.posicao}º da fila.` : ''}`;
}

/** A MENSAGEM POSITIVA: o pagamento está confirmado no sistema. */
export function textoDoPago(p: PedidoDoComprovante, o: { sinal?: boolean } = {}): string {
  const nome = primeiroNome(p.clienteNome);
  const titulo = o.sinal || (p.sinalPago && !p.pago) ? 'Sinal confirmado' : 'Pagamento confirmado';
  return [`✅ *${titulo}*${nome ? `, ${nome}` : ''}!`, `Seu pedido nº ${p.numero} ${situacaoDoPedido(p)}.`, 'Obrigado pela preferência 🙌'].join('\n');
}

/** O Pix ainda não confirmou no provedor (a 1ª vez: só informa). */
export function textoDoAguardando(p: PedidoDoComprovante): string {
  return [
    'Recebi seu comprovante 🙌',
    `O pagamento do pedido nº ${p.numero} ainda não apareceu por aqui — o Pix pode levar alguns instantes. Assim que cair, o pedido entra em preparo.`,
    'Vale o Pix feito pelo código deste pedido. Se o valor já saiu da sua conta e não confirmar em alguns minutos, me manda o comprovante de novo que a equipe confere.',
  ].join('\n');
}

/** O Pix continua sem confirmar e o cliente mandou o comprovante de novo: a equipe confere. */
export function textoDoAguardandoComEquipe(p: PedidoDoComprovante, c: EquipeChamada): string {
  return [`O pagamento do pedido nº ${p.numero} ainda não confirmou por aqui.`, fraseDaEquipe(c)].join('\n');
}

/** O pedido é para pagar na entrega: a equipe confere o Pix (senão o entregador cobraria de novo). */
export function textoDoNaEntrega(p: PedidoDoComprovante, c: EquipeChamada): string {
  return [
    'Recebi seu comprovante 🙌',
    `O pedido nº ${p.numero} está marcado para *pagar na ${p.tipo === 'entrega' ? 'entrega' : 'retirada'}*, então o pagamento não confirma sozinho por aqui.`,
    fraseDaEquipe(c),
  ].join('\n');
}

/** O pedido cancelado: pago = o estorno automático (o mesmo texto do status); sem pagamento confirmado = a equipe. */
export function textoDoCancelado(p: PedidoDoComprovante, c: EquipeChamada): string {
  if (p.pago)
    return `O pedido nº ${p.numero} foi cancelado. O valor pago no Pix será devolvido automaticamente para a mesma conta, pela instituição financeira — costuma cair em poucos minutos.`;
  return [
    `O pedido nº ${p.numero} foi cancelado${p.statusPagamento === 'aguardando' ? ' porque o pagamento não foi confirmado no prazo' : ''}.`,
    `Se o valor saiu da sua conta, a equipe confere. ${fraseDaEquipe(c)}`,
  ].join('\n');
}

/**
 * Não há pedido com este telefone. O pedido fica ligado ao número informado na hora de pedir: pede o número usado (a
 * resposta cai direto com a equipe, que já foi chamada). Nunca diz nada do pedido de outro número.
 */
export function textoDoSemPedido(c: EquipeChamada): string {
  return [
    'Recebi seu comprovante 🙌',
    'Só que não achei pedido feito com este número de WhatsApp. O pedido fica ligado ao telefone informado na hora de pedir — pode ter sido outro número?',
    `Me diz por aqui o telefone (com DDD) que você colocou no pedido, ou o número do pedido. ${fraseDaEquipe(c)}`,
  ].join('\n');
}
