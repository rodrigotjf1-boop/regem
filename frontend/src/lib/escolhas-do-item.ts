/* eslint-disable @typescript-eslint/no-explicit-any */

/** Um item do pedido como o painel mostra: o nome e as escolhas, uma por linha. */
export type ItemComEscolhas = { nome: string; escolhas: string[] };

// Separador das escolhas no texto de uma linha só — o do canal ("Batata média · Coca-Cola") e o nosso (backend
// `common/adicionais.ts`, SEPARADOR_ESCOLHAS).
const SEPARADOR = ' · ';

const comSinal = (s: string) => (/^(\+|-|sem\b)/i.test(s) ? s : `+ ${s}`);

/**
 * O item do pedido com as escolhas UMA POR LINHA, para o cartão do painel do delivery (pedido do dono, 28/10/2026: como
 * no Anota AI — o produto e, embaixo, recuadas, a batata e a bebida do combo). Dois formatos chegam:
 *  • pedido de CANAL: as escolhas no campo `complementos` ("Batata média · 2x Coca-Cola");
 *  • nosso CARDÁPIO: as escolhas no fim do nome, entre parênteses ("X-Burger (2x Bacon, Sem cebola)"), quando o item
 *    traz as opções (`opcaoIds`) — sem elas, o parêntese é do nome do produto e fica.
 * O que vem sem sinal ganha o "+" ("sem …" fica como está).
 */
export function itemComEscolhas(it: any): ItemComEscolhas {
  const nome = String(it?.descricao ?? it?.nome ?? '').trim();
  const comp = typeof it?.complementos === 'string' ? it.complementos.trim() : '';
  if (comp) {
    return { nome, escolhas: comp.split(SEPARADOR).map((s: string) => s.trim()).filter(Boolean).map(comSinal) };
  }
  const temOpcoes = Array.isArray(it?.opcaoIds) && it.opcaoIds.length > 0;
  const m = temOpcoes ? /^(.*\S)\s+\(([^()]+)\)$/.exec(nome) : null;
  if (m) {
    return { nome: m[1], escolhas: m[2].split(', ').map((s) => s.trim()).filter(Boolean).map(comSinal) };
  }
  return { nome, escolhas: [] };
}
