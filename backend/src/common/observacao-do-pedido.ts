// A OBSERVAÇÃO DO PEDIDO (mig 346 — pedido do dono, 31/10/2026): a observação GERAL ("interfone ruim, ligar ao chegar,
// não buzinar"), além da de cada item. Escrita pelo cliente no cardápio online ou pelo robô do WhatsApp; aparece no
// painel, na via do entregador, no app e na página do entregador.
//
// Como fica gravada: UMA linha — quebra de linha e caractere de controle viram espaço, porque a via impressa lê marcas no
// começo da linha (`@QR:`, `@B`, `@GAVETA`) e o texto do cliente não pode virar comando da impressora —, sem espaço
// repetido, até 300 letras. Vazia = null (sem observação).

export const MAX_OBSERVACAO_DO_PEDIDO = 300;

// Caracteres de controle (0x00–0x1F e 0x7F) e os separadores de linha do Unicode (0x2028, 0x2029). Os separadores são
// montados por código: escritos como escape no fonte, viraram o próprio caractere ao gravar e quebraram o regex.
const CONTROLE = new RegExp(`[\\x00-\\x1f\\x7f${String.fromCharCode(0x2028, 0x2029)}]+`, 'g');

export function textoDaObservacao(v: unknown): string | null {
  const t = String(v ?? '')
    .replace(CONTROLE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_OBSERVACAO_DO_PEDIDO)
    .trim();
  return t || null;
}
