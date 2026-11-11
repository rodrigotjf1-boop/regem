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
//             manda o preço de venda) e o "Pausado na 99" (`canais_pausados` com '99food'). Os dois vão à 99 na
//             hora, item a item (a fila da mig 402); o "Exportar catálogo" tira da 99 o que está pausado lá.
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

// ── O COMPLEMENTO (opção do catálogo) por canal — R3 F3a ───────────────────────────────────────────────────────────
// O preço do complemento no Regem é POR GRUPO (`complemento_item.preco`: o balcão e o cardápio digital cobram o do grupo
// em que ele aparece); nos apps é UM por código PDV (`opcao.preco_ifood`, mig 369; `opcao.preco_99`, mig 401), o mesmo em
// todos os grupos. A pausa é por canal (`opcao.canais_pausados`: 'regem', 'ifood', '99food' — decisão 14); o "Em falta"
// (`opcao.esgotado`) segue valendo em TODOS os canais, como sempre.

/** O id do complemento (ou do grupo) na rota: um uuid (senão, 400 — nunca chega ao banco). */
export function exigirIdDaOpcao(id: unknown, motivo = 'Complemento inválido.'): string {
  if (typeof id !== 'string' || !ID.test(id)) throw new BadRequestException(motivo);
  return id;
}

export const CANAIS_DE_PRECO_DA_OPCAO = ['ifood', '99food'] as const;
export type CanalDePrecoDaOpcao = (typeof CANAIS_DE_PRECO_DA_OPCAO)[number];

export function exigirCanalDePrecoDaOpcao(v: unknown): CanalDePrecoDaOpcao {
  if (typeof v === 'string' && (CANAIS_DE_PRECO_DA_OPCAO as readonly string[]).includes(v)) return v as CanalDePrecoDaOpcao;
  throw new BadRequestException('Canal inválido para o preço do complemento: use "ifood" ou "99food" (o do Regem é o de cada grupo).');
}

/**
 * O preço de um COMPLEMENTO num app: a regra do preço no app (vazio limpa — o Regem deixa de mexer no preço de lá; até 2
 * casas) e zero VALE (o complemento grátis lá, como a maionese da casa). Ausente é erro: a rota existe para mudar o preço.
 */
export function precoDaOpcaoNoApp(valor: unknown, canal: CanalDePrecoDaOpcao): string | null {
  const onde = canal === 'ifood' ? 'no iFood' : 'na 99';
  if (valor === undefined) throw new BadRequestException(`Informe o preço ${onde} (ou deixe em branco para o Regem não mexer nele).`);
  const v = canal === 'ifood' ? precoIfoodDoPedido(valor) : preco99DoPedido(valor);
  return v ?? null;
}

/**
 * O preço do complemento NUM GRUPO do Regem (`complemento_item.preco`): obrigatório, de zero (grátis) até R$ 999.999,99,
 * com até 2 casas (aceita vírgula). Qualquer outra coisa é recusada com o motivo.
 */
export function precoNoGrupoDoPedido(valor: unknown): string {
  const n =
    typeof valor === 'number' ? valor : typeof valor === 'string' && valor.trim() !== '' ? Number(valor.trim().replace(',', '.')) : NaN;
  if (!Number.isFinite(n) || n < 0) throw new BadRequestException('Preço do complemento inválido: informe um valor de zero para cima (ex.: 4,50).');
  if (n > PRECO_MAXIMO) throw new BadRequestException('Preço do complemento acima de R$ 999.999,99: confira o valor digitado.');
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) {
    throw new BadRequestException('Preço do complemento com mais de 2 casas decimais: use centavos (ex.: 4,50).');
  }
  return n.toFixed(2);
}
