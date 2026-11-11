import { BadRequestException } from '@nestjs/common';
import { precoIfoodDoPedido } from '../../common/ifood-pelo-orzuni';
import { preco99DoPedido } from '../../common/precos-na-99';

// GESTÃO DO CATÁLOGO › PRODUTOS E PREÇOS (R3, fase F1; protótipo aprovado pelo dono em 11/11/2026 —
// `mockups/regem-conciliacao-ifood.html`). O preço e a pausa de UM canal por vez, cada mudança com auditoria (de → para).
//
// Os canais, no que o Regem já guarda:
//   • regem — o balcão e o cardápio digital: o preço é o de venda (`preco_venda`); a pausa desliga os dois juntos
//             (`disponivel_balcao` e `disponivel_cardapio`: decisão 12 do protótipo). Desde a mig 399 isso NÃO pausa no
//             iFood (decisão 1: cada canal se pausa no seu botão).
//   • ifood — o preço no iFood (`preco_ifood`, mig 369, só com o direito `ifood_pelo_orzuni`) e o "Pausado no iFood"
//             (`canais_pausados` com 'ifood'). O envio ao iFood é a fila do Orzuni (gatilho da mig 370/399).
//   • 99food — o preço na 99 (`preco_99`, mig 401, só com o direito `precos_na_99`; vazio = o "Exportar catálogo" da 99
//             manda o preço de venda) e o "Pausado na 99" (`canais_pausados` com '99food'): sai do cardápio no próximo
//             envio à 99. O envio item a item à 99 é a fase F2b.
// A pausa num canal da lista `canais_pausados` põe ou tira SÓ aquele canal, na própria instrução do banco — nunca regrava
// a lista inteira (o totem também mexe nela: a pausa dele não pode sumir).

export const CANAIS_DE_PRECO = ['regem', 'ifood', '99food'] as const;
export type CanalDePreco = (typeof CANAIS_DE_PRECO)[number];
export const CANAIS_DE_PAUSA = ['regem', 'ifood', '99food'] as const;
export type CanalDePausa = (typeof CANAIS_DE_PAUSA)[number];

/** O maior preço que a tela aceita (o mesmo teto do preço do iFood). */
const PRECO_MAXIMO = 999_999.99;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O id do produto na rota: um uuid (senão, 400 — nunca chega ao banco). */
export function exigirIdDoProduto(id: unknown): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new BadRequestException('Produto inválido.');
  return id;
}

export function exigirCanalDePreco(v: unknown): CanalDePreco {
  if (typeof v === 'string' && (CANAIS_DE_PRECO as readonly string[]).includes(v)) return v as CanalDePreco;
  throw new BadRequestException('Canal inválido para o preço: use "regem", "ifood" ou "99food".');
}

export function exigirCanalDePausa(v: unknown): CanalDePausa {
  if (typeof v === 'string' && (CANAIS_DE_PAUSA as readonly string[]).includes(v)) return v as CanalDePausa;
  throw new BadRequestException('Canal inválido para a pausa: use "regem", "ifood" ou "99food".');
}

/**
 * O preço de venda (Regem) que veio no pedido, pronto para gravar: obrigatório, maior que zero, até R$ 999.999,99 e com
 * até 2 casas (aceita vírgula). Qualquer outra coisa é recusada com o motivo — nunca vira zero.
 */
export function precoDeVendaDoPedido(valor: unknown): string {
  const n =
    typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor.trim().replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new BadRequestException('Preço de venda inválido: informe um valor maior que zero (ex.: 39,90).');
  if (n > PRECO_MAXIMO) throw new BadRequestException('Preço de venda acima de R$ 999.999,99: confira o valor digitado.');
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    throw new BadRequestException('Preço de venda com mais de 2 casas decimais: use centavos (ex.: 39,90).');
  }
  return n.toFixed(2);
}

/**
 * O preço no iFood de um PRODUTO que veio no pedido: a regra do cadastro (`precoIfoodDoPedido`: vazio limpa — o Regem
 * deixa de mexer no preço de lá) e mais uma — zero não vale, porque o iFood não aceita item com preço zero (o envio o
 * dispensaria e a tela mostraria um preço que nunca chegou lá). Ausente é erro aqui: a rota existe para mudar o preço.
 */
export function precoIfoodDoCanal(valor: unknown): string | null {
  if (valor === undefined) throw new BadRequestException('Informe o preço no iFood (ou deixe em branco para o Regem não mexer nele).');
  const v = precoIfoodDoPedido(valor);
  if (v === '0.00') throw new BadRequestException('O iFood não aceita item com preço zero: informe o preço ou deixe em branco.');
  return v ?? null;
}

/**
 * O preço na 99 de um PRODUTO que veio no pedido: a mesma regra do preço no iFood (vazio limpa — o "Exportar catálogo" da 99
 * volta a mandar o preço de venda) e zero não vale: o preço do item na 99 é o que o cliente paga, e zero sairia de graça.
 * Ausente é erro aqui: a rota existe para mudar o preço.
 */
export function preco99DoCanal(valor: unknown): string | null {
  if (valor === undefined) throw new BadRequestException('Informe o preço na 99 (ou deixe em branco para o Regem não mexer nele).');
  const v = preco99DoPedido(valor);
  if (v === '0.00') throw new BadRequestException('Preço zero na 99 sairia de graça para o cliente: informe o preço ou deixe em branco.');
  return v ?? null;
}
