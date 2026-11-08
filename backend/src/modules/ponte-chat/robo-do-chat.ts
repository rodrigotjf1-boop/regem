import { ehSoAgradecimento } from './casos-do-chat';
import { TEXTO_MAX, primeiroNome, temContatoProibido } from './texto-do-chat';
import type { ResumoDoRobo } from '../atendimento/resumo-do-robo';
import type { ModoEntrega } from '../entregador/modo-entrega';
import { type SituacaoDaEquipe, fraseForaDoHorario, textoDaVolta } from '../atendimento/horario-da-equipe';

// O ROBÔ NO CHAT DO iFOOD E DA 99 (ponte do chat, Etapa 3 — protótipo `mockups/regem-central-atendimento.html` v3: "o robô
// responde no chat com o dado do pedido (cozinha, saída, entregador, previsão). O que ele não resolve vira caso com o
// resumo, e ele diz ao cliente que a equipe já foi chamada"). Robô PRÓPRIO do Regem, por REGRAS — sem IA: ele só fala do
// que o Regem sabe do pedido (a situação e a previsão), com frases fixas que já passam na trava da plataforma; o resto
// é da equipe. O agente de IA do WhatsApp (n8n) pode assumir depois — fica como evolução.
//
// Ligado em Delivery › Configurações › Atendimento › "iFood e 99 · chat pela ponte" › "Robô responde no chat"
// (`robo_config.chat_robo_responde`, nasce desligado). Por conversa (= o pedido), na entrada das mensagens:
//   • caso aberto (com alguém ou na fila) → o robô fica QUIETO (a equipe já está nela) — o RECADO que espera a abertura
//     (mig 379, fora do horário da equipe) não conta: quem chama passa `casoAberto` falso e o robô segue respondendo;
//   • agradecimento curto → nada (nem resposta, nem caso);
//   • "cadê meu pedido?" / previsão, com o pedido ligado e situação que ele sabe dizer → RESPONDE (sem caso), no máximo
//     2 vezes por pedido por hora — a 3ª pergunta é de quem precisa de uma pessoa;
//   • o resto (reclamação, troca, pedido entregue que "não chegou", cancelado…) → CHAMA A EQUIPE: o caso abre com o
//     resumo do robô e o cliente recebe, uma vez, "já chamei a equipe".

export type Intencao = 'onde_esta' | 'agradecimento' | 'outra';

/** O texto em minúsculas, sem acento e sem pontuação, com um espaço entre as palavras. */
export function normalizar(texto: string | null | undefined): string {
  return String(texto ?? '')
    .toLocaleLowerCase('pt-BR')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Onde está / quando chega / vai demorar. */
const ONDE_ESTA =
  /\b(cade|onde (esta|ta|anda|fica) (o |meu )?(meu )?pedido|onde (esta|ta)\b|ja saiu|saiu ja|vai demorar|demora|demorando|atrasad\w*|quanto tempo|previsao|que horas|a que horas|chega quando|quando chega|ta chegando|esta chegando|falta muito|ainda nao chegou|nao chegou|ta vindo|esta vindo|vem quando)\b/;
/** Reclamação, troca, cancelamento, reembolso, endereço, raiva: é da equipe, mesmo junto de um "cadê". */
const DA_EQUIPE =
  /\b(errad\w*|faltou|veio sem|veio faltando|frio|fria|estragad\w*|cru|crua|cancel\w*|reembols\w*|devolv\w*|estorn\w*|troco|endereco|trocar|troca|mudar|alterar|reclam\w*|pessimo|horrivel|absurdo|vergonha|ridiculo|nunca mais|procon)\b/;
/** Cliente chateado: o caso nasce urgente. */
const CHATEADO = /\b(absurdo|vergonha|ridiculo|pessimo|horrivel|nunca mais|procon|palhacada|descaso|raiva)\b/;

export function intencaoDoCliente(texto: string | null | undefined): Intencao {
  if (ehSoAgradecimento(texto)) return 'agradecimento';
  const t = normalizar(texto);
  if (!t || t.length > 160) return 'outra'; // texto longo costuma explicar um problema: é da equipe
  if (DA_EQUIPE.test(t)) return 'outra';
  return ONDE_ESTA.test(t) ? 'onde_esta' : 'outra';
}

export const ehChateado = (texto: string | null | undefined) => CHATEADO.test(normalizar(texto));

export type PedidoDoRobo = {
  status: string;
  despachadoEm: string | Date | null;
  /** Quem entrega (`modoEntrega`, a regra única): a loja, o entregador da plataforma, ou é retirada. */
  modo: ModoEntrega;
  cliente: string | null;
  canal: 'ifood' | '99food';
};

const horaDe = (iso: string | Date | null): string | null => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }).replace(':', 'h');
};

/**
 * A resposta do robô ao "cadê meu pedido?", pelo que o Regem sabe do pedido. `null` = ele não sabe dizer (entregue,
 * concluído, cancelado, situação desconhecida) — aí chama a equipe. `horaPrevista` no formato do aviso "saiu" ("20h15").
 */
export function respostaDoRobo(p: PedidoDoRobo, horaPrevista: string | null): string | null {
  const nome = primeiroNome(p.cliente);
  const oi = nome ? `Oi, ${nome}!` : 'Oi!';
  const doApp = p.canal === 'ifood' ? 'do iFood' : 'da 99';
  const chega = horaPrevista ? ` Chega por volta das ${horaPrevista}.` : '';
  const retirada = p.modo === 'retirada';
  const daPlataforma = p.modo === 'logistica_canal';
  let t: string | null = null;
  switch (p.status) {
    case 'novo':
    case 'confirmado':
      t = retirada
        ? `${oi} Seu pedido está sendo preparado e logo fica pronto para retirar.`
        : `${oi} Seu pedido está sendo preparado e sai em breve.${daPlataforma ? '' : chega}`;
      break;
    case 'pronto':
      t = retirada
        ? `${oi} Seu pedido está pronto: já pode retirar na loja.`
        : daPlataforma
          ? `${oi} Seu pedido está pronto, esperando o entregador ${doApp}.`
          : `${oi} Seu pedido está pronto e sai em instantes.${chega}`;
      break;
    case 'despachado': {
      if (retirada) break;
      if (daPlataforma) {
        t = `${oi} Seu pedido já saiu com o entregador ${doApp}. Dá para acompanhar pelo app ${doApp}.`;
        break;
      }
      const saiu = horaDe(p.despachadoEm);
      t = `${oi} Seu pedido saiu${saiu ? ` às ${saiu}` : ''}${horaPrevista ? ` e chega por volta das ${horaPrevista}` : ' e já está a caminho'}.`;
      break;
    }
    default:
      t = null;
  }
  // As frases são fixas, mas a regra da plataforma vale para tudo o que sai (e o nome vem do pedido).
  if (!t || t.length > TEXTO_MAX || temContatoProibido(t)) return null;
  return t;
}

/** O que o robô diz uma vez, quando chama a equipe. */
export const CHAMEI_A_EQUIPE = 'Já chamei a equipe da loja. Em instantes alguém responde por aqui.';

/** Fora do horário, quando a frase da loja e a padrão não passam na trava da plataforma (não acontece com a padrão). */
export const FORA_DO_HORARIO_FIXA = 'Nossa equipe não está agora. Já deixei o seu recado aqui e respondemos assim que começarmos.';

/**
 * HORÁRIO DA EQUIPE (mig 379): o que o robô diz no lugar do "Já chamei a equipe" quando o caso nasceu RECADO (fora do
 * horário): a frase da loja com o dia e a hora em que a equipe volta (pelo `ate` do recado). Tudo o que sai no chat da
 * plataforma passa pela trava dela (nada de telefone, WhatsApp, Instagram ou link) e cabe em 300 letras; se a frase da
 * loja não passa, vai a padrão; se nem ela, uma frase fixa sem hora.
 */
export function fraseForaDoHorarioNoChat(equipe: SituacaoDaEquipe | null | undefined, recado: { ate?: unknown } | null | undefined): string {
  const ate = typeof recado?.ate === 'string' ? new Date(recado.ate) : null;
  const volta = textoDaVolta(ate && !Number.isNaN(ate.getTime()) ? ate : (equipe?.voltaEm ?? null));
  const candidatas = [fraseForaDoHorario(equipe?.textoFora ?? null, volta), fraseForaDoHorario(null, volta)];
  return candidatas.find((t) => t.length <= TEXTO_MAX && !temContatoProibido(t)) ?? FORA_DO_HORARIO_FIXA;
}

/** No máximo tantas respostas do robô por pedido na última hora — depois, a pergunta repetida vai para uma pessoa. */
export const RESPOSTAS_POR_HORA = 2;

export type Decisao =
  | { acao: 'responder'; texto: string }
  | { acao: 'chamar_equipe'; resumo: ResumoDoRobo; urgente: boolean }
  | { acao: 'quieto' }
  | { acao: 'nada' };

export function decidir(c: {
  intencao: Intencao;
  casoAberto: boolean;
  respostasNaHora: number;
  pedido: PedidoDoRobo | null;
  horaPrevista: string | null;
  fala: string;
  canal: 'ifood' | '99food';
  /**
   * Algum PC da ponte ENVIA pelo canal agora (a regra do `pegar`)? Sem ele (pausada, sem login, ou a 99 só lendo — 4a),
   * o robô não fala: o que ele dissesse ficaria na fila e cairia em 30 min, e o cliente ficaria sem resposta e sem caso.
   */
  envia?: boolean;
}): Decisao {
  if (c.casoAberto) return { acao: 'quieto' };
  if (c.intencao === 'agradecimento') return { acao: 'nada' };
  const envia = c.envia !== false;
  const resposta = envia && c.intencao === 'onde_esta' && c.pedido && c.respostasNaHora < RESPOSTAS_POR_HORA ? respostaDoRobo(c.pedido, c.horaPrevista) : null;
  if (resposta) return { acao: 'responder', texto: resposta };
  const chateado = ehChateado(c.fala);
  const plataforma = c.canal === 'ifood' ? 'do iFood' : 'da 99';
  const motivo =
    c.intencao === 'onde_esta'
      ? c.respostasNaHora >= RESPOSTAS_POR_HORA
        ? 'Perguntou de novo pelo pedido (o robô já respondeu)'
        : envia
          ? 'Perguntou pelo pedido (o robô não tem como dizer)'
          : 'Perguntou pelo pedido'
      : `Mensagem no chat ${plataforma}`;
  return {
    acao: 'chamar_equipe',
    urgente: chateado,
    resumo: {
      // "cliente chateado" vem do humor (a tela junta ao motivo — não repetir aqui).
      motivo,
      quer: String(c.fala ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
      jaFez: envia ? 'Avisou o cliente no chat que chamou a equipe da loja' : `Não respondeu: nenhum PC da ponte envia pelo chat ${plataforma} agora`,
      humor: chateado ? 'chateado' : null,
    },
  };
}

// ───────────────────────── o ATENDENTE VIRTUAL no chat (F5 do atendente virtual, mig 383) ─────────────────────────
// `robo_config.chat_robo_modo` (nasce 'regras' = nada muda): com 'atendente', a conversa vai ao robô com IA do n8n (o mesmo
// do WhatsApp e do Direct — chave `chat:`) no lugar das frases fixas; o que ele escreve passa pela trava da plataforma
// (`texto-do-chat.ts`). As regras de ANTES de responder são as mesmas do robô por regras (caso aberto = quieto, agradecimento
// = nada) e o atendente nunca deixa a conversa sem nada: sem quem envie pelo canal, sem o robô pronto nesta instalação (o
// endereço e a senha do robô) ou sem cardápio ativo para ele consultar, vale o robô por regras; a entrega ao n8n que falha
// também cai nas regras (quem chama refaz a decisão em modo 'regras'). Limite de segurança: 8 falas do atendente por pedido
// por hora — passou disso, a equipe (como a 3ª pergunta do robô por regras).

export const MODOS_DO_ROBO_NO_CHAT = ['regras', 'atendente'] as const;
export type ModoDoRoboNoChat = (typeof MODOS_DO_ROBO_NO_CHAT)[number];
/** O modo como veio do banco: só 'atendente' liga o atendente virtual; o resto (sem coluna, nulo, lixo) é 'regras'. */
export const modoDaLinha = (v: unknown): ModoDoRoboNoChat => (v === 'atendente' ? 'atendente' : 'regras');

/** No máximo tantas falas (mensagens) do atendente virtual por pedido na última hora — depois, a equipe. */
export const FALAS_DO_ATENDENTE_POR_HORA = 8;

export type DecisaoNoChat = Decisao | { acao: 'atendente' };

/**
 * A decisão de uma conversa do lote, nos dois modos. 'regras' = `decidir`, sem tirar nem pôr (nada muda para quem não
 * escolheu o atendente). 'atendente': quieto e nada como as regras; sem quem envie ou sem o atendente pronto → `decidir`;
 * 8 falas do atendente na hora → chama a equipe; senão → `atendente` (a fala vai ao robô com IA, sem caso).
 */
export function decidirNoChat(
  c: Parameters<typeof decidir>[0] & { modo: ModoDoRoboNoChat; atendentePronto: boolean; falasDoAtendenteNaHora: number },
): DecisaoNoChat {
  if (c.modo !== 'atendente') return decidir(c);
  if (c.casoAberto) return { acao: 'quieto' };
  if (c.intencao === 'agradecimento') return { acao: 'nada' };
  if (c.envia === false || !c.atendentePronto) return decidir(c);
  if (c.falasDoAtendenteNaHora >= FALAS_DO_ATENDENTE_POR_HORA) return chamarPeloLimite(c.fala);
  return { acao: 'atendente' };
}

/** O caso que o limite de falas do atendente abre (a regra é uma só: a entrada e a resposta do robô usam esta). */
export function chamarPeloLimite(fala: string | null | undefined): Extract<Decisao, { acao: 'chamar_equipe' }> {
  const chateado = ehChateado(fala);
  return {
    acao: 'chamar_equipe',
    urgente: chateado,
    resumo: {
      motivo: `O atendente virtual já respondeu ${FALAS_DO_ATENDENTE_POR_HORA} vezes a este pedido na última hora`,
      quer: String(fala ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
      jaFez: 'Avisou o cliente no chat que chamou a equipe da loja',
      humor: chateado ? 'chateado' : null,
    },
  };
}

/** O pedido no campo `pedido` da mensagem ao atendente: o que o robô por regras sabe dizer, para ele responder sem ferramenta. */
export type PedidoParaOAtendente = {
  /** O número que o cliente vê no app da plataforma. */
  numero: string | null;
  status: string;
  /** A situação em palavras. */
  situacao: string;
  /** Quem entrega (`modoEntrega`): a loja, o entregador da plataforma, ou é retirada. */
  quemEntrega: 'loja' | 'plataforma' | 'retirada';
  /** A hora em que saiu ("20h05"), quando saiu. */
  saiuAs: string | null;
  /** A previsão de chegada ("20h32" — a mesma conta do aviso "saiu"), só na entrega da loja. */
  previsao: string | null;
  /** O que o robô por regras responderia ao "cadê meu pedido?" (null = ele não sabe dizer: entregue, cancelado…). */
  respostaPronta: string | null;
};

export function pedidoParaOAtendente(p: PedidoDoRobo, numero: string | null | undefined, horaPrevista: string | null): PedidoParaOAtendente {
  const quemEntrega = p.modo === 'retirada' ? 'retirada' : p.modo === 'logistica_canal' ? 'plataforma' : 'loja';
  const doApp = p.canal === 'ifood' ? 'do iFood' : 'da 99';
  const situacoes: Record<string, string> = {
    novo: 'recebido pela loja, entrando em preparo',
    confirmado: 'em preparo na loja',
    pronto:
      quemEntrega === 'retirada'
        ? 'pronto para retirar na loja'
        : quemEntrega === 'plataforma'
          ? `pronto, esperando o entregador ${doApp}`
          : 'pronto, sai para entrega em instantes',
    despachado:
      quemEntrega === 'retirada'
        ? 'pronto para retirar na loja'
        : quemEntrega === 'plataforma'
          ? `saiu com o entregador ${doApp} (o cliente acompanha pelo app ${doApp})`
          : 'saiu para entrega com o entregador da loja',
    entregue: 'entregue',
    concluido: 'concluído',
    cancelado: 'cancelado',
  };
  const encerrado = ['entregue', 'concluido', 'cancelado'].includes(p.status);
  const previsao = quemEntrega === 'loja' && !encerrado ? horaPrevista : null;
  return {
    numero: numero ? String(numero) : null,
    status: p.status,
    situacao: situacoes[p.status] ?? 'em andamento',
    quemEntrega,
    saiuAs: p.status === 'despachado' && quemEntrega !== 'retirada' ? horaDe(p.despachadoEm) : null,
    previsao,
    respostaPronta: respostaDoRobo(p, previsao),
  };
}

/**
 * A situação do pedido da conversa em uma frase, para as ferramentas de pedido do robô com `chat:` (`publico/bot/pedidos`
 * e `pedido-status`) — sem Pix nem estorno do cardápio próprio: no iFood e na 99 o pagamento é da plataforma.
 */
export function textoDoPedidoNoChat(p: PedidoDoRobo): string {
  const a = pedidoParaOAtendente(p, null, null);
  return `Situação do pedido: ${a.situacao}${a.saiuAs ? ` (saiu às ${a.saiuAs})` : ''}.`;
}
