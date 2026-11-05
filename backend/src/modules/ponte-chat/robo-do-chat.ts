import { ehSoAgradecimento } from './casos-do-chat';
import { TEXTO_MAX, primeiroNome, temContatoProibido } from './texto-do-chat';
import type { ResumoDoRobo } from '../atendimento/resumo-do-robo';
import type { ModoEntrega } from '../entregador/modo-entrega';

// O ROBÔ NO CHAT DO iFOOD E DA 99 (ponte do chat, Etapa 3 — protótipo `mockups/regem-central-atendimento.html` v3: "o robô
// responde no chat com o dado do pedido (cozinha, saída, entregador, previsão). O que ele não resolve vira caso com o
// resumo, e ele diz ao cliente que a equipe já foi chamada"). Robô PRÓPRIO do Regem, por REGRAS — sem IA: ele só fala do
// que o Regem sabe do pedido (a situação e a previsão), com frases fixas que já passam na trava da plataforma; o resto
// é da equipe. O agente de IA do WhatsApp (n8n) pode assumir depois — fica como evolução.
//
// Ligado em Delivery › Configurações › Atendimento › "iFood e 99 · chat pela ponte" › "Robô responde no chat"
// (`robo_config.chat_robo_responde`, nasce desligado). Por conversa (= o pedido), na entrada das mensagens:
//   • caso aberto (com alguém ou na fila) → o robô fica QUIETO (a equipe já está nela);
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
}): Decisao {
  if (c.casoAberto) return { acao: 'quieto' };
  if (c.intencao === 'agradecimento') return { acao: 'nada' };
  const resposta = c.intencao === 'onde_esta' && c.pedido && c.respostasNaHora < RESPOSTAS_POR_HORA ? respostaDoRobo(c.pedido, c.horaPrevista) : null;
  if (resposta) return { acao: 'responder', texto: resposta };
  const chateado = ehChateado(c.fala);
  const plataforma = c.canal === 'ifood' ? 'do iFood' : 'da 99';
  const motivo =
    c.intencao === 'onde_esta'
      ? c.respostasNaHora >= RESPOSTAS_POR_HORA
        ? 'Perguntou de novo pelo pedido (o robô já respondeu)'
        : 'Perguntou pelo pedido (o robô não tem como dizer)'
      : `Mensagem no chat ${plataforma}`;
  return {
    acao: 'chamar_equipe',
    urgente: chateado,
    resumo: {
      // "cliente chateado" vem do humor (a tela junta ao motivo — não repetir aqui).
      motivo,
      quer: String(c.fala ?? '').replace(/\s+/g, ' ').trim().slice(0, 300) || null,
      jaFez: 'Avisou o cliente no chat que chamou a equipe da loja',
      humor: chateado ? 'chateado' : null,
    },
  };
}
