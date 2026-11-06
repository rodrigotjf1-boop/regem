/* eslint-disable @typescript-eslint/no-explicit-any */

// (Sem importar o `robo-mudanca.ts`: ele importa daqui — os dois auxiliares abaixo são os mesmos de lá.)
const r2 = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
const noPedido = (numero: string | null | undefined) => (numero ? `pedido nº ${numero}` : 'pedido');

// O ROBÔ PÕE ITEM NO PEDIDO JÁ PAGO NO PIX (mig 373; pedido do dono de 06/11/2026). As regras puras: a validade do Pix, os
// textos que o cliente e a equipe leem e o que cada situação quer dizer. Quem gera, acompanha e aplica é o
// `adicional-pix.service.ts`; quem oferece é o robô (`robo-pedido.service.ts`, pela conferência da mudança).

/** O Pix do adicional vale 5 minutos (o dono: "informar ao cliente que ele tem 5 min para pagar, se não o link expira"). */
export const VALIDADE_DO_PIX_DO_ADICIONAL_MIN = 5;
/** Depois de vencido, a Rede (que não deixa cancelar o QR) ainda é conferida por este tempo: pagou tarde, devolve. */
export const CONFERIR_DEPOIS_DE_VENCIDO_MIN = 30;
/** O estorno do adicional que não entrou: 3 tentativas; na 3ª falha, caso URGENTE no Atendimento (devolver à mão). */
export const TENTATIVAS_DO_ESTORNO_DO_ADICIONAL = 3;

/** As situações em que o Pix do adicional está ABERTO: o alerta da Central fica até sair delas. */
export const SITUACOES_ABERTAS = ['aguardando', 'pago', 'pedido_a_loja'] as const;
export type SituacaoDoAdicional =
  | 'aguardando'
  | 'pago'
  | 'pedido_a_loja'
  | 'aplicado'
  | 'expirado'
  | 'estornar'
  | 'estornando'
  | 'estornado'
  | 'falhou';

const valor = (v: number) => `R$ ${r2(v).toFixed(2).replace('.', ',')}`;
const maiusculo = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Os botões da conferência pelo Pix. */
export const OPCAO_MANDAR_PIX = 'Mandar o Pix';

/**
 * A conferência da mudança no pedido já pago: as linhas da mudança (o cabeçalho de sempre) e o aviso do Pix — o valor, os
 * 5 minutos e o que acontece se não pagar ("o pedido pode sair sem o item", palavras do dono).
 */
export function avisoDoPixNaConferencia(diferenca: number): string {
  return [
    `Este pedido já foi pago no Pix. Para pôr o item, eu te mando um Pix de ${valor(diferenca)}.`,
    `Ele vale ${VALIDADE_DO_PIX_DO_ADICIONAL_MIN} minutos: se não for pago a tempo, o código expira e o pedido pode sair sem o item.`,
  ].join('\n');
}

/** A mensagem que vai com o código (o código vai SOZINHO na mensagem seguinte, para copiar com um toque). */
export function textoDoPix(numero: string | null, descricao: string, diferenca: number): string {
  return [
    `Aqui está o Pix de ${valor(diferenca)} para pôr ${descricao} no ${noPedido(numero)} 👇`,
    `Vale por ${VALIDADE_DO_PIX_DO_ADICIONAL_MIN} minutos. Assim que o pagamento cair, o item entra no pedido e eu te aviso aqui.`,
    'Se não for pago a tempo, o código expira e o pedido pode sair sem o item.',
  ].join('\n');
}

/** Pago e a mudança entrou (loja sem servidor ligado: a nuvem aplicou). */
export function textoDoPagoAplicado(numero: string | null, descricao: string, total: number): string {
  return `✅ Pagamento recebido! ${maiusculo(descricao)} entrou no ${noPedido(numero)}.\nTotal: ${valor(total)}.`;
}

/** Pago e a mudança foi ao servidor da loja (ele aplica; a confirmação vem depois). */
export function textoDoPagoPedido(numero: string | null, descricao: string): string {
  return `✅ Pagamento recebido! Pedi à loja para pôr ${descricao} no ${noPedido(numero)} ⏳ Te confirmo aqui em instantes.`;
}

/** O servidor da loja confirmou a mudança paga. */
export function textoDaLojaConfirmou(numero: string | null, descricao: string, total: number | null): string {
  return `✅ A loja confirmou: ${descricao} entrou no ${noPedido(numero)}.${total != null ? `\nTotal: ${valor(total)}.` : ''}`;
}

/** O Pix venceu sem pagamento: o pedido segue como estava. */
export function textoDoVencido(numero: string | null, descricao: string): string {
  return `O Pix para pôr ${descricao} no ${noPedido(numero)} expirou sem pagamento, e o pedido segue como estava. Se ainda quiser o item, é só me dizer.`;
}

/**
 * Pago, mas o item não entrou (o pedido já tinha saído, a loja recusou, não respondeu): o valor volta sozinho, como no
 * cancelamento (`texto-do-estorno.ts` da tela, mig 372).
 */
export function textoDoNaoEntrou(numero: string | null, descricao: string, diferenca: number): string {
  return [
    `Recebi o Pix de ${valor(diferenca)}, mas não deu para pôr ${descricao} no ${noPedido(numero)} (o pedido já estava saindo).`,
    'O valor será devolvido automaticamente para a mesma conta, pela instituição financeira — costuma cair em poucos minutos.',
  ].join('\n');
}

/** O alerta da Central (fora da fila): o que a equipe lê enquanto o Pix do adicional está aberto. */
export function textoDoAlerta(a: { numero: string | null; descricao: string; valor: number; situacao: string }): string {
  const n = a.numero ? `#${a.numero}` : '';
  if (a.situacao === 'aguardando')
    return `Pedido ${n}: o robô está pondo ${a.descricao} (${valor(a.valor)}) e espera o Pix do cliente. Segure o pedido: não libere até a conclusão.`;
  return `Pedido ${n}: o Pix de ${a.descricao} (${valor(a.valor)}) foi pago — a mudança está entrando. Segure o pedido até a via "PEDIDO ALTERADO" sair.`;
}

/** O caso URGENTE quando o estorno do adicional não sai (a loja devolve à mão). */
export function textoDoCasoDoEstorno(a: { numero: string | null; descricao: string; valor: number; gateway: string; motivo: string }): string {
  const nome = ({ mercadopago: 'Mercado Pago', pagseguro: 'PagBank', rede: 'Rede' } as Record<string, string>)[a.gateway] ?? a.gateway;
  return (
    `O estorno do Pix do item novo do pedido #${a.numero ?? ''} (${a.descricao}, ${valor(a.valor)}) não saiu: devolva o valor ao ` +
    `cliente pelo app do ${nome}. Motivo do ${nome}: ${a.motivo}`
  );
}

/** A descrição curta do que entra ("1x Coca lata"), para o alerta e as mensagens. */
export function descricaoDoQueEntra(op: any): string {
  const e = op?.entra;
  if (!e) return 'o item';
  const q = String(Number(e.quantidade) || 1).replace('.', ',');
  return `${q}x ${String(e.descricao ?? 'item')}`;
}
