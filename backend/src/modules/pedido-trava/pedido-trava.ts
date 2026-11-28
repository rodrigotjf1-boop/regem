// A TRAVA DO PEDIDO ENQUANTO O CLIENTE ALTERA (mig 517) — as regras puras (sem banco). Pedido do dono, 28/11/2026:
// "quando o cliente tentar editar o pedido e o atendimento entender, ele trava o pedido e o pedido entra em modo edição
// pelo cliente na cozinha pedindo a pausa até que o cliente conclua a alteração, para não ter o risco do pedido sair."
// Protótipo aprovado no mesmo dia: `mockups/regem-pedido-em-alteracao.html` (TR-1 a TR-8, as recomendadas).
//
// - TR-1: a trava começa quando o atendente manda a CONFERÊNCIA da mudança (a mensagem com os botões).
// - TR-2: segura o pedido inteiro — "Pronto", "Despachar" e "Saiu para entrega" recusam com o motivo.
// - TR-3: vale até o cliente confirmar, desistir ou 10 minutos; com o Pix do item novo, até ele ser pago ou vencer.
// - TR-4: "Liberar o pedido" à mão (senha do gerente e o motivo): a mudança é descartada, o Pix aberto é cancelado e o
//   cliente é avisado.
// - TR-5: venceu sem resposta: o pedido segue como estava e o cliente é avisado.
// - TR-7: só os pedidos que o atendente altera (WhatsApp e cardápio do Regem) — iFood e 99 não passam por aqui.
// - TR-8: o atendente diz que PEDIU para a cozinha segurar — nunca que a cozinha parou.
import { horaNoFuso } from '../../common/data';
import { noPedido } from '../cardapio/robo-mudanca';

/** TR-3: quanto a trava vale sem resposta (o mesmo prazo do Pix do item novo, `VALIDADE_DO_PIX_DO_ADICIONAL_MIN`). */
export const VALIDADE_DA_TRAVA_MIN = 10;

// confirmada: a mudança entrou (ou foi pedida ao servidor da loja e ele decidiu); desistiu: "Deixar como estava";
// vencida: sem resposta no prazo (ou o Pix do item venceu); liberada: "Liberar o pedido" da loja; descartada: a mudança
// não seguiu por outro motivo (o pedido andou, a gravação recusou, outra mudança tomou o lugar, o Pix não saiu).
export const SITUACOES_DA_TRAVA = ['ativa', 'confirmada', 'desistiu', 'vencida', 'liberada', 'descartada'] as const;
export type SituacaoDaTrava = (typeof SITUACOES_DA_TRAVA)[number];
export type FimDaTrava = Exclude<SituacaoDaTrava, 'ativa'>;

/** O código da recusa de "Pronto", "Despachar" e "Saiu" com a trava valendo (a tela abre o diálogo pelo código). */
export const CODIGO_PEDIDO_EM_ALTERACAO = 'PEDIDO_EM_ALTERACAO';

/**
 * A versão do servidor da loja que já segura o pedido (o `.zip` que traz a mig 517 e as recusas). A loja com servidor numa
 * versão anterior não trava: o "Pronto" e o "Despachar" de lá não conhecem a trava, e o robô não pode prometer ao cliente
 * o que a cozinha não vai fazer. Sem servidor ligado, a nuvem segura (`DeliveryService.travaValeNaLoja`).
 */
export const VERSAO_MINIMA_DA_TRAVA = '1.30.17';

/** O motivo do "Liberar o pedido": obrigatório, até 200 letras (vai para o histórico e a auditoria). */
export const MOTIVO_DO_LIBERAR_MAX = 200;

export type TravaDoPedido = {
  id: string;
  pedidoId: string;
  quer: string;
  ate: string; // ISO
  situacao: SituacaoDaTrava;
};

/** A trava segura o pedido? Só a ativa e dentro do prazo (o fim por tempo não depende de ninguém gravar). */
export function travaVale(t: Pick<TravaDoPedido, 'situacao' | 'ate'> | null | undefined, agora = Date.now()): boolean {
  return !!t && t.situacao === 'ativa' && new Date(t.ate).getTime() > agora;
}

/** Até quando a trava nova vale (TR-3). */
export function ateDaTrava(agora = Date.now()): Date {
  return new Date(agora + VALIDADE_DA_TRAVA_MIN * 60_000);
}

/** "até 20:00" — a hora no fuso da operação (a nuvem roda em UTC). */
export function horaDaTrava(ate: string | Date): string {
  return horaNoFuso(new Date(ate));
}

/** A recusa de "Pronto", "Despachar" e "Saiu para entrega" (TR-2), com o que a tela precisa para o diálogo. */
export function recusaDaTrava(t: Pick<TravaDoPedido, 'id' | 'ate' | 'quer'>) {
  return {
    statusCode: 409,
    code: CODIGO_PEDIDO_EM_ALTERACAO,
    message: `O cliente está alterando este pedido pelo WhatsApp (até ${horaDaTrava(t.ate)}). Espere a resposta dele ou libere o pedido.`,
    trava: { id: t.id, ate: new Date(t.ate).toISOString(), quer: t.quer },
  };
}

/** TR-8: a linha que vai no fim da conferência da mudança — "pedi", nunca "a cozinha parou". */
export function linhaDaTravaNaConferencia(ate: string | Date): string {
  return `⏸ Pedi para a cozinha segurar o seu pedido enquanto você confere (até ${horaDaTrava(ate)}).`;
}

/** TR-5: venceu sem resposta — o pedido segue como estava. */
export function textoDaTravaVencida(numero: string | null): string {
  return (
    `Como não tive a sua resposta, o ${noPedido(numero)} *segue como estava* ✅ e a cozinha continuou.\n\n` +
    'Se ainda quiser mudar, é só me dizer — enquanto ele não sair, dá para mudar.'
  );
}

/** TR-4: a loja liberou o pedido — segue como estava, sem a mudança (e o Pix aberto, cancelado). */
export function textoDoPedidoLiberado(numero: string | null, pixCancelado: boolean): string {
  return (
    `A loja precisou seguir com o ${noPedido(numero)} *como estava*, sem a mudança.` +
    (pixCancelado ? '\n\nO Pix do item novo foi cancelado — nada foi cobrado.' : '') +
    '\n\nSe quiser, alguém da equipe fala com você por aqui.'
  );
}

/** O motivo do "Liberar o pedido", conferido (obrigatório, sem espaço sobrando, até o limite). */
export function motivoDoLiberar(v: unknown): string | null {
  const t = String(v ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t.slice(0, MOTIVO_DO_LIBERAR_MAX) : null;
}
